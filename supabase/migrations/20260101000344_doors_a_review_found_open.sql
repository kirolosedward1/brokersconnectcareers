-- =============================================================================
-- 344 — Doors a review found open
--
-- A review of the final schema — every policy, guard and definer function,
-- read as each kind of account sees it — found these. Each is closed here and
-- tested in supabase/tests/doors.test.mjs.
--
--  1. Private notes on rows others read. Suspending a company, or the account
--     of a company's last approved member, copied the private reason into each
--     listing's rejection_note, which every candidate who applied can read.
--     The reason stays where 327 and 305 moved it (company_moderation,
--     profile_private); the listing says only that it was taken down.
--  2. A report told the reporter more than they could see. The snapshot
--     prepare_report writes, which the reporter reads back and is quoted in
--     their bell, held the consultant's name, handle and account even when
--     the card was shown to them anonymised, or not at all. It now holds what
--     the reporter could see; and a report needs a target the reporter can
--     see — a listing they can read, a card the directory lists to them.
--  3. A membership row's person and company could be rewritten by a company
--     admin; the guard checked deletes and demotions only. Who and where are
--     fixed once a row exists — outside the admin console.
--  4. A suspended company kept the directory: the gated cards' names and the
--     contact reveals a verified company is trusted with. Suspension ends it
--     for the company's members.
--  5. companies.logo_url took any https address. Like an avatar (322), it is
--     a file in the company's own folder of company-logos now.
--  6. The directory's row policies never asked whether the consultant is an
--     approved candidate, as every directory function does: a suspended or
--     held consultant's profile stayed readable through the table.
--  7. Reviewed verification papers could be deleted or replaced in the bucket
--     while their row still said verified. A reviewed file stays as reviewed.
--  8. Withdrawing an application freed its place under the apply limit, which
--     counted rows the candidate can delete. It counts a ledger now.
--  9. An employer could rewrite the experience band an applicant declared.
-- 10. A consultant could take another card's id as their slug, and handles
--     resolve by slug or id: one handle answered with two cards.
-- 11. created_at was writable on companies and consultant profiles.
-- 12. "Save draft" on a closed or expired listing always failed: the guard let
--     those go to review only. A draft is private and costs nothing.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: forward-fix only — each change restores a rule the code already assumed; to undo one, restate the function or policy from the migration named beside it below (327, 319, 326, 317, 307, 308, 322, 309, 306, 11, 59)
-- safety: ships-with-code — every check here is already met by what the website and the app write: production on 2026-10-02 has no copied notes, no reports, no suspended company, no id-shaped slug, and its one logo is in its own folder
-- safety: rls — each policy is restated whole with one condition added (the report's target is one its reporter can see; a directory row is an approved candidate's; a reviewed paper stays as reviewed), so it can only narrow what a caller reads or writes; the owner, admin and applicant policies are untouched
-- safety: grant — agent_owner_listed, agent_card_listed_to_viewer and company_document_reviewed are executable by anon because row policies call them for every caller, anon included; each answers yes or no about an id the caller already holds, as can_browse_agent_directory and applied_to_my_job do
-- safety: revoke-anon — the same three keep anon's execute on purpose, for the row policies (see grant); my_company_suspended is revoked from anon and only ever called inside definer functions
-- safety: constraint — agent_profiles_slug_not_an_id is added not valid and validated in the same file: production has no id-shaped slug (2026-10-02), the slug maker never makes one, and a profile's own id stays allowed

-- ---------------------------------------------------------------------------
-- 1. A listing taken down for a suspension says so, and nothing more
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_company_suspension(p_company uuid, p_suspend boolean, p_reason text default null::text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company companies%rowtype;
  v_reason  text;
  v_down    int := 0;
begin
  perform public.admin_begin();

  select * into v_company from companies where id = p_company for update;
  if not found then
    raise exception 'not_found';
  end if;

  v_reason := public.admin_reason(p_reason, true);

  if p_suspend and v_company.suspended_at is not null then
    raise exception 'no_change' using hint = 'The company is already suspended.';
  end if;
  if not p_suspend and v_company.suspended_at is null then
    raise exception 'no_change' using hint = 'The company is not suspended.';
  end if;

  if p_suspend then
    insert into company_moderation (company_id, suspension_reason, updated_at)
    values (p_company, v_reason, now())
    on conflict (company_id) do update
      set suspension_reason = excluded.suspension_reason, updated_at = now();

    update companies
       set suspended_at = now(), suspension_reason = null
     where id = p_company;

    -- Not the reason: every candidate who applied reads rejection_note. The
    -- company's members have the reason in company_moderation.
    update jobs
       set status = 'rejected', rejection_note = 'الشركة موقوفة'
     where company_id = p_company and status in ('active', 'pending_review');
    get diagnostics v_down = row_count;
  else
    update company_moderation
       set suspension_reason = null, updated_at = now()
     where company_id = p_company;

    update companies
       set suspended_at = null, suspension_reason = null
     where id = p_company;
  end if;

  perform public.admin_audit(
    case when p_suspend then 'company.suspended' else 'company.restored' end,
    'company', p_company::text, v_company.name_ar, v_reason,
    jsonb_build_object('listings_taken_down', v_down));

  return v_down;
end;
$$;

create or replace function public.set_account_approval(p_user uuid, p_status approval_status, p_note text default null::text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile profiles%rowtype;
  v_note    text;
  v_down    int := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_user = auth.uid() then
    raise exception 'an admin cannot change their own approval';
  end if;

  perform set_config('app.admin_console', 'on', true);

  select * into v_profile from profiles where id = p_user and role <> 'admin' for update;
  if not found then
    raise exception 'no such account, or it belongs to an admin';
  end if;

  if v_profile.approval_status = p_status then
    raise exception 'no_change' using hint = format('The account is already %s.', p_status);
  end if;

  -- At most 500 characters, the same cap profile_private enforces, so a long
  -- note is refused as 'reason_too_long' rather than as a constraint name.
  v_note := public.admin_reason(p_note, p_status = 'rejected', 500);

  -- The note first: the notification trigger on profiles reads it, and it
  -- fires as part of the UPDATE below.
  insert into profile_private (user_id, approval_note, updated_at)
  values (p_user, v_note, now())
  on conflict (user_id) do update
    set approval_note = excluded.approval_note,
        updated_at    = now();

  update profiles
     set approval_status = p_status,
         approved_at     = case when p_status = 'approved' then now() else null end
   where id = p_user;

  if p_status = 'rejected' then
    /*
      The profile above is already suspended by the time this runs, so the
      "is anybody else still approved" test does not need to exclude the target
      by status — but it does exclude them by id, because a company whose only
      member has just been suspended must not count that member as cover for
      itself.

      Not the note: every candidate who applied reads rejection_note, and the
      note is the reviewer's, kept in profile_private for the account and the
      console.
    */
    update jobs
       set status = 'rejected',
           rejection_note = 'الحساب موقوف'
     where status in ('active', 'pending_review')
       and company_id in (
         select cm.company_id
           from company_members cm
          where cm.user_id = p_user
            and not exists (
              select 1
                from company_members peer
                join profiles p on p.id = peer.user_id
               where peer.company_id = cm.company_id
                 and peer.user_id <> p_user
                 and p.approval_status = 'approved'
            )
       );
    get diagnostics v_down = row_count;
  end if;

  perform public.admin_audit(
    case
      when p_status = 'rejected' then 'user.suspended'
      when p_status = 'pending'  then 'user.held'
      when v_profile.approval_status = 'rejected' then 'user.restored'
      else 'user.approved'
    end,
    'user', p_user::text, v_profile.full_name, v_note,
    jsonb_build_object('from', v_profile.approval_status, 'to', p_status,
                       'role', v_profile.role, 'listings_taken_down', v_down));
end;
$$;

-- Any reason or note already copied, put back to the words above.
update jobs j
   set rejection_note = 'الشركة موقوفة'
  from company_moderation m
 where m.company_id = j.company_id
   and m.suspension_reason is not null
   and j.rejection_note = m.suspension_reason;

update jobs j
   set rejection_note = 'الحساب موقوف'
  from company_members cm
  join profile_private pp on pp.user_id = cm.user_id
 where cm.company_id = j.company_id
   and pp.approval_note is not null
   and j.rejection_note = pp.approval_note;

-- ---------------------------------------------------------------------------
-- 2. A report holds what its reporter could see, about what they could see
-- ---------------------------------------------------------------------------

-- A card the directory shows this viewer at all — named or anonymised, as
-- search_agents lists it: an approved candidate's, not hidden, to somebody
-- who may browse the directory, an employer the consultant applied to, or an
-- admin. (agent_card_open_to_viewer is the narrower question: shown named.)
create or replace function public.agent_card_listed_to_viewer(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from agent_profiles a
      join profiles p on p.id = a.user_id
     where a.id = p_agent
       and p.role = 'candidate'
       and p.approval_status = 'approved'
       and a.visibility <> 'hidden'
       and (
         public.is_admin()
         or public.applied_to_my_job(a.user_id)
         or public.can_browse_agent_directory()
       )
  );
$$;

revoke execute on function public.agent_card_listed_to_viewer(uuid) from public;
grant  execute on function public.agent_card_listed_to_viewer(uuid) to anon, authenticated;

create or replace function public.prepare_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  if num_nonnulls(new.job_id, new.company_id, new.agent_id) <> 1 then
    raise exception 'report_target_required'
      using hint = 'A report is about exactly one listing, company or consultant profile.';
  end if;

  new.target_type := case when new.job_id is not null then 'job'
                          when new.company_id is not null then 'company'
                          else 'agent' end;
  new.target_id   := coalesce(new.job_id, new.company_id, new.agent_id);
  new.abusive     := false;
  new.source      := case
                       when coalesce(current_setting('app.system_report', true), 'off') = 'on' then 'system'
                       else 'user'
                     end;

  if new.target_type = 'job' then
    select jsonb_build_object(
             'label_ar', j.title_ar, 'label_en', j.title_en, 'slug', j.slug,
             'status', j.status, 'company_id', j.company_id,
             'company_name_ar', c.name_ar, 'company_name_en', c.name_en,
             'excerpt', left(j.description_ar, 600))
      into v_snapshot
      from jobs j
      join companies c on c.id = j.company_id
     where j.id = new.job_id;
  elsif new.target_type = 'company' then
    select jsonb_build_object(
             'label_ar', c.name_ar, 'label_en', c.name_en, 'slug', c.slug,
             'company_id', c.id, 'website', c.website,
             'verification_status', c.verification_status,
             'excerpt', left(coalesce(c.about_ar, c.about_en), 600))
      into v_snapshot
      from companies c
     where c.id = new.company_id;
  else
    /*
      The reporter reads this row back, and the bell quotes its label when the
      report is closed, so it holds what the card showed them: the name, the
      handle and the account only on a card open to them (asked as the
      reporter — the helper reads their own claims); on a card the directory
      lists to them anonymised, "a consultant profile" and its headline, as
      the listing showed them; otherwise only the words. A moderator opens the
      profile by target_id.
    */
    select case
             when new.source = 'system' or public.agent_card_open_to_viewer(a.id) then
               jsonb_build_object(
                 'label_ar', coalesce(p.full_name, a.slug), 'label_en', coalesce(p.full_name, a.slug),
                 'slug', a.slug, 'user_id', a.user_id, 'visibility', a.visibility,
                 'excerpt', left(coalesce(a.headline_ar, a.headline_en), 300))
             when public.agent_card_listed_to_viewer(a.id) then
               jsonb_build_object(
                 'label_ar', 'ملف استشاري', 'label_en', 'Consultant profile',
                 'excerpt', left(coalesce(a.headline_ar, a.headline_en), 300))
             else
               jsonb_build_object('label_ar', 'ملف استشاري', 'label_en', 'Consultant profile')
           end
      into v_snapshot
      from agent_profiles a
      left join profiles p on p.id = a.user_id
     where a.id = new.agent_id;
  end if;

  new.target_snapshot := coalesce(v_snapshot, '{}'::jsonb);
  return new;
end;
$$;

-- The insert policy, restated whole (317's, plus the target being one the
-- reporter can see). The listing is read under the reporter's own row
-- security: a draft or a listing in another company's review is not theirs
-- to report, and its snapshot is not theirs to read.
drop policy if exists reports_insert_signed_in on reports;
create policy reports_insert_signed_in on reports
  for insert with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and resolved_by is null
    and exists (
      select 1 from profiles p
       where p.id = (select auth.uid()) and p.approval_status <> 'rejected'
    )
    and (company_id is null or not public.owns_company(company_id))
    and (agent_id is null or not exists (
      select 1 from agent_profiles a where a.id = agent_id and a.user_id = (select auth.uid())
    ))
    and (job_id is null or exists (select 1 from jobs j where j.id = reports.job_id))
    and (agent_id is null or public.agent_card_listed_to_viewer(agent_id))
  );

-- ---------------------------------------------------------------------------
-- 3. A membership is one person in one company
-- ---------------------------------------------------------------------------

create or replace function public.guard_company_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_role  user_role;
begin
  -- Who and where are fixed once the row exists: a member's row changes role,
  -- nothing else. Rewriting user_id handed the owner's own row — and their
  -- place in the company — to somebody else, with no trace in the audit log;
  -- rewriting company_id moved a member into a second company past the rule
  -- at the end. Admins keep the escape hatch for a genuine transfer.
  if tg_op = 'UPDATE' and not public.acting_as_admin()
     and (new.company_id, new.user_id) is distinct from (old.company_id, old.user_id)
  then
    raise exception 'company_member_identity'
      using hint = 'A membership changes role; to move somebody, remove them and add the other account.';
  end if;

  select owner_id into v_owner
    from companies where id = coalesce(new.company_id, old.company_id);

  if tg_op = 'DELETE' and old.user_id = v_owner then
    raise exception 'company_owner_membership'
      using hint = 'The owner cannot be removed from their own company.';
  end if;

  if tg_op = 'UPDATE' and old.user_id = v_owner and new.role <> 'admin' then
    raise exception 'company_owner_membership'
      using hint = 'The owner is always an admin of their own company.';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select role into v_role from profiles where id = new.user_id;
    if v_role = 'candidate' then
      raise exception 'company_member_role'
        using hint = 'Only an employer account can be added to a company.';
    end if;
  end if;

  -- Uninvited, and already somewhere else: refused. Admins keep the escape
  -- hatch for a genuine transfer.
  if tg_op = 'INSERT' and not public.acting_as_admin()
     and exists (
       select 1 from company_members m
        where m.user_id = new.user_id and m.company_id <> new.company_id
     )
  then
    raise exception 'company_member_elsewhere'
      using hint = 'This account already belongs to another company.';
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A suspended company's members leave the directory
-- ---------------------------------------------------------------------------

create or replace function public.my_company_suspended()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from company_members m
      join companies c on c.id = m.company_id
     where m.user_id = auth.uid() and c.suspended_at is not null
  );
$$;

revoke execute on function public.my_company_suspended() from public, anon;
grant  execute on function public.my_company_suspended() to authenticated;

comment on function public.my_company_suspended() is
  'Whether the caller belongs to a suspended company. See migration 344.';

-- Every directory read — the listing, the card, the reveal, the view
-- recorder, the row policies — asks this one predicate (322), so the
-- suspension is asked here once.
create or replace function public.can_browse_agent_directory()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin()
      or (public.is_approved_employer() and not public.my_company_suspended());
$$;

-- What a verified company is trusted with, a suspended one is not.
create or replace function public.viewer_has_verified_company()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.in_good_standing() and exists (
    select 1 from company_members m
      join companies c on c.id = m.company_id
     where m.user_id = auth.uid()
       and c.verification_status = 'verified'
       and c.suspended_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. A logo is a file in the company's own folder
-- ---------------------------------------------------------------------------

create or replace function public.guard_company_logo()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then return new; end if;
  if new.logo_url is null then return new; end if;
  if tg_op = 'UPDATE' and new.logo_url is not distinct from old.logo_url then
    return new;
  end if;
  -- What the upload action writes: the storage's public address of a file it
  -- re-encoded into this company's folder. The app draws logos straight from
  -- this address on every card, so anything else would be a third party told
  -- who is scrolling the board — or another company's logo.
  if new.logo_url ~ ('^https://[A-Za-z0-9.-]+/storage/v1/object/public/company-logos/'
                     || new.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$') then
    return new;
  end if;
  raise exception 'logo_url must be a file in the company''s own logo folder'
    using hint = 'Upload the logo through the company page.';
end;
$$;

revoke execute on function public.guard_company_logo() from public, anon, authenticated;

drop trigger if exists companies_06_guard_logo on companies;
create trigger companies_06_guard_logo
  before insert or update of logo_url on companies
  for each row execute function public.guard_company_logo();

-- ---------------------------------------------------------------------------
-- 6. The directory's rows are approved consultants', as its functions are
-- ---------------------------------------------------------------------------

create or replace function public.agent_owner_listed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from profiles p
     where p.id = p_user and p.role = 'candidate' and p.approval_status = 'approved'
  );
$$;

-- anon too: a row policy is evaluated for every caller, and a helper the
-- caller may not run turns "no rows" into a permission error.
revoke execute on function public.agent_owner_listed(uuid) from public;
grant  execute on function public.agent_owner_listed(uuid) to anon, authenticated;

comment on function public.agent_owner_listed(uuid) is
  'Whether a consultant profile''s owner is an approved candidate — the test the '
  'directory functions apply, for the row policies. See migration 344.';

-- 322's two directory policies, plus the owner's standing. The owner, the
-- employer somebody applied to and an admin read through their own policies,
-- unchanged.
drop policy if exists agent_profiles_select_public on agent_profiles;
create policy agent_profiles_select_public on agent_profiles
  for select using (
    visibility = 'public'
    and (select public.can_browse_agent_directory())
    and public.agent_owner_listed(user_id)
  );

drop policy if exists agent_profiles_select_gated on agent_profiles;
create policy agent_profiles_select_gated on agent_profiles
  for select using (
    visibility = 'verified_employers_only'
    and (select public.viewer_has_verified_company())
    and (select public.can_browse_agent_directory())
    and public.agent_owner_listed(user_id)
  );

-- ---------------------------------------------------------------------------
-- 7. A reviewed verification paper stays as it was reviewed
-- ---------------------------------------------------------------------------

create or replace function public.company_document_reviewed(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from company_documents d
     where d.storage_path = p_path and d.status <> 'pending'
  );
$$;

revoke execute on function public.company_document_reviewed(text) from public;
grant  execute on function public.company_document_reviewed(text) to anon, authenticated;

-- 309's one FOR ALL policy, split: reading and adding as before; replacing or
-- removing only a file no review has looked at. The row was already fixed
-- once reviewed (company_documents_delete takes pending rows only) — "the row
-- and the file have to agree" (24), and the file is the evidence.
drop policy if exists "owners manage their verification documents" on storage.objects;

drop policy if exists "owners read their verification documents" on storage.objects;
create policy "owners read their verification documents"
  on storage.objects for select
  using (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "owners add verification documents" on storage.objects;
create policy "owners add verification documents"
  on storage.objects for insert
  with check (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
    and public.storage_folder_count('company-documents', (storage.foldername(name))[1]) < 20
  );

drop policy if exists "owners replace unreviewed verification documents" on storage.objects;
create policy "owners replace unreviewed verification documents"
  on storage.objects for update
  using (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
    and not public.company_document_reviewed(name)
  )
  with check (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
    and not public.company_document_reviewed(name)
  );

drop policy if exists "owners remove unreviewed verification documents" on storage.objects;
create policy "owners remove unreviewed verification documents"
  on storage.objects for delete
  using (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
    and not public.company_document_reviewed(name)
  );

-- ---------------------------------------------------------------------------
-- 8. The apply limit counts what was sent, not what is left
-- ---------------------------------------------------------------------------

create or replace function public.enforce_application_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_short   record;
  v_day     record;
  v_short_n int;
  v_day_n   int;
  v_bucket  text := 'applications:' || new.candidate_id::text;
begin
  -- No bypass for the service role, on purpose: the cap is a property of the
  -- table, as migration 19 made it, and the tests hold it against every caller.
  perform pg_advisory_xact_lock(hashtext('applications:' || new.candidate_id::text));

  select * into v_short from public.limit_for('applications:user:10min', 600, 8);
  select * into v_day   from public.limit_for('applications:user:day', 86400, 30);

  /*
    Each application sent leaves a hit in rate_limit_hits, which no candidate
    can delete: counting the applications themselves let a withdrawal —
    which deletes the row — hand its place back, so eight sent and withdrawn
    every few minutes never met the cap. The rows still count too, for the
    applications sent before this ledger began (the greater of the two).
  */
  select greatest(
           (select count(*) from rate_limit_hits h
             where h.bucket = v_bucket
               and h.created_at > now() - make_interval(secs => v_short.window_seconds)),
           (select count(*) from applications
             where candidate_id = new.candidate_id
               and created_at > now() - make_interval(secs => v_short.window_seconds)))
    into v_short_n;

  select greatest(
           (select count(*) from rate_limit_hits h
             where h.bucket = v_bucket
               and h.created_at > now() - make_interval(secs => v_day.window_seconds)),
           (select count(*) from applications
             where candidate_id = new.candidate_id
               and created_at > now() - make_interval(secs => v_day.window_seconds)))
    into v_day_n;

  if v_short_n >= v_short.max_hits or v_day_n >= v_day.max_hits then
    perform public.record_security_event(
      'applications.rate_limited',
      case when v_day_n >= v_day.max_hits then 'warning' else 'info' end,
      null,
      jsonb_build_object('short', v_short_n, 'day', v_day_n),
      new.candidate_id
    );
    raise exception 'application_rate_limit'
      using hint = 'Too many applications from this account. Try again later.';
  end if;

  insert into rate_limit_hits (bucket) values (v_bucket);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The applicant's own words stay theirs
-- ---------------------------------------------------------------------------

create or replace function public.guard_application_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  -- The experience band is what the applicant declared, the same as their
  -- note and their CV: the employer moves the status and writes the decision.
  if (new.job_id, new.candidate_id, new.cv_path, new.note, new.created_at, new.experience_band)
     is distinct from
     (old.job_id, old.candidate_id, old.cv_path, old.note, old.created_at, old.experience_band)
  then
    raise exception 'only the application status and decision note may be changed';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. A slug is not another card's id
-- ---------------------------------------------------------------------------

-- reveal_agent_contact, get_agent_card and record_agent_view find a card by
-- `slug = handle or id = handle`. A slug shaped like a card id could be
-- another card's — the handle then found two, and a reveal answered with
-- whichever came first. Its own id is allowed: that is the same card.
alter table agent_profiles drop constraint if exists agent_profiles_slug_not_an_id;
alter table agent_profiles
  add constraint agent_profiles_slug_not_an_id
  check (
    slug !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or slug = id::text
  ) not valid;
alter table agent_profiles validate constraint agent_profiles_slug_not_an_id;

-- ---------------------------------------------------------------------------
-- 11. When a row was made is not the owner's to set
-- ---------------------------------------------------------------------------

create or replace function public.guard_company_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then return new; end if;

  -- The public address of the company. Permanent, because other people's
  -- links and other people's saved rows point at it.
  if new.slug is distinct from old.slug then
    raise exception 'a company slug is permanent — links and follows point at it';
  end if;

  -- Verification is set by review, with one exception below it.
  if new.verification_status is distinct from old.verification_status then
    -- Submitting papers is a transition the company makes, and the only one.
    -- Anything other than unverified/rejected -> pending is still a refusal,
    -- so this cannot become a way to arrive at `verified`.
    if not (
      coalesce(current_setting('app.submitting_for_review', true), 'off') = 'on'
      and new.verification_status = 'pending'
      and old.verification_status in ('unverified', 'rejected')
    ) then
      raise exception 'verification_status is set by review, not by the owner';
    end if;
  end if;

  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set by review, not by the owner';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'company ownership cannot be transferred';
  end if;
  -- A company's age is a review signal ("new company"); backdating it hid one.
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not owner-writable';
  end if;

  -- Credits move only when platform code says it is granting them. The marker
  -- is transaction-local and set inside a SECURITY DEFINER function; a client
  -- speaking to PostgREST has no statement with which to set it.
  if new.post_credits is distinct from old.post_credits
     and coalesce(current_setting('app.granting_credits', true), 'off') <> 'on' then
    raise exception 'post_credits is set by billing, not by the owner';
  end if;

  return new;
end;
$$;

create or replace function public.guard_agent_restriction()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.restricted_at is not null or new.restriction_reason is not null then
      raise exception 'restriction is an admin action';
    end if;
    return new;
  end if;

  if (new.restricted_at, new.restriction_reason) is distinct from (old.restricted_at, old.restriction_reason) then
    raise exception 'restriction is an admin action';
  end if;

  -- The directory breaks ties by it: a card dated in the future sat first.
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not owner-writable';
  end if;

  -- Coerced, not refused: the profile form sends visibility on every save,
  -- and refusing would lock a restricted consultant out of editing anything.
  if old.restricted_at is not null then
    new.visibility := 'hidden';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. A closed or expired listing can go back to being a draft
-- ---------------------------------------------------------------------------

create or replace function public.guard_job_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ok boolean;
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if new.company_id is distinct from old.company_id then
    raise exception 'a job cannot be moved between companies';
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'a listing slug is permanent — links point at it';
  end if;
  if new.is_featured is distinct from old.is_featured then
    raise exception 'featured placement is granted by billing, not by the owner';
  end if;
  if new.view_count is distinct from old.view_count then
    raise exception 'view_count is not owner-writable';
  end if;
  if (new.published_at, new.expires_at, new.featured_until)
     is distinct from (old.published_at, old.expires_at, old.featured_until) then
    raise exception 'the posting window is stamped at publication, not set by the owner';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not owner-writable';
  end if;
  if new.rejection_note is distinct from old.rejection_note then
    raise exception 'rejection_note is written by review';
  end if;

  /*
    A listing that has ended — closed by its owner, or past its date — may be
    kept as a draft as well as sent to review: the wizard offers "save draft"
    on every listing that is not live, and from these two the guard refused
    it, every time. A draft is private and spends nothing; publishing still
    goes through review.
  */
  if new.status is distinct from old.status then
    ok := case old.status
      when 'draft'          then new.status in ('draft', 'pending_review')
      when 'pending_review' then new.status in ('draft', 'pending_review')
      when 'active'         then new.status = 'closed'
                                 or (new.status in ('pending_review', 'draft')
                                     and old.expires_at is not null
                                     and old.expires_at <= now())
      when 'expired'        then new.status in ('draft', 'pending_review', 'closed')
      when 'closed'         then new.status in ('draft', 'pending_review')
      when 'rejected'       then new.status in ('draft', 'pending_review')
      else false
    end;

    if not ok then
      raise exception 'job status cannot go from % to %', old.status, new.status
        using hint = 'Publishing is a moderation action.';
    end if;
  end if;

  -- Editing a live post sends it back for review rather than silently changing
  -- what was already approved. Migration 66's eight fields, plus the four that
  -- turn one listing into another: where it is, which track, what kind of
  -- contract, and how senior. Requirements, translations, benefits and the
  -- commission note stay cosmetic — a typo fix there should not cost a day
  -- off the board.
  if old.status = 'active' and new.status = 'active'
     and (new.title_ar, new.description_ar, new.basic_salary_min, new.basic_salary_max,
          new.commission_type, new.commission_value, new.leads_source, new.seats,
          new.district_id, new.track, new.employment_type, new.experience_band)
      is distinct from
         (old.title_ar, old.description_ar, old.basic_salary_min, old.basic_salary_max,
          old.commission_type, old.commission_value, old.leads_source, old.seats,
          old.district_id, old.track, old.employment_type, old.experience_band)
  then
    new.status := 'pending_review';
  end if;

  return new;
end;
$$;
