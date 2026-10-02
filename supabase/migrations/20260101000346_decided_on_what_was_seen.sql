-- =============================================================================
-- 346 — Decided on what was seen
--
-- A review of the admin console, the email outbox and the file buckets found
-- decisions taken on something other than what the person deciding saw, and
-- files that did not stay as they were checked:
--
--  1. A retry batch shared one lease token, and claim_email hands a retry any
--     row in the batch whose key it claims. A rebuild that writes to every
--     member of a company claimed its colleagues' rows, sent them, and could
--     not record them — so each was sent again on its own turn: the j-th row
--     of a batch went out j times. Each row now has its own token.
--  2. A verified company could rename itself after a developer or another
--     verified company and keep the badge unflagged: the name check is skipped
--     for a verified company. A new name that borrows one goes to the queue.
--  3. An appeal outlived the decision it was about. Overturning it lifted
--     whatever decision stood by then — a hold appealed, lifted by hand, and a
--     fraud suspension since was lifted by overturning the old appeal. It now
--     reverses only the decision appealed, and a listing edited since it was
--     appealed is restored from its page, where it is read as it is.
--  4. Approve and verify acted on the listing or company as it was at the
--     click, not as the page showed it: an employer swapping a pending
--     listing's text between the two was approved unseen. The page sends the
--     version it showed, and a change since is refused.
--  5. Reports: an admin could delete them with no trace; "resolved, nothing
--     taken down" told the reporter "we acted on it"; the overview's count lost
--     reports about a deleted listing.
--  6. The console's account search compared raw text: «احمد» found nobody
--     called «أحمد».
--  7. An account deletion request could be filed signed out, and closing one
--     recorded nobody.
--  8. Files: a company could have the server delete a reviewed paper (its
--     byte check removes what fails it) and upload another at the same path;
--     a CV or a pending paper could be overwritten after the check; a photo or
--     logo could be written straight into the public buckets past the
--     re-encode that strips location data; and the paper cap counted papers
--     the company can no longer remove.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: restate lease_due_emails() from migration 324, flag_company_text() from 327, appeal_decision_snapshot() and admin_decide_appeal() from 328, tell_reporter_outcome() from 326, admin_overview() from 318 and admin_search_users() from 319; drop function public.appeal_decision_state(moderation_appeals), public.admin_close_deletion_request(uuid), public.guard_account_deletion_request(), public.company_documents_open_count(text), public.cv_in_use(text); drop function public.admin_moderate_job(uuid, text, text, int) and public.admin_review_company(uuid, text, text, int) and restate both three-argument functions from 318 with their grants; drop trigger reports_90_audit_direct_admin_write on reports; drop trigger support_requests_05_deletion_needs_account on support_requests; grant delete on reports to authenticated; drop policies reports_admin_read, reports_admin_file and reports_admin_update and restate reports_admin from migration 4; restore storage policies "owners add verification documents" and "owners replace unreviewed verification documents" from 344, "candidates manage their own cv" from 332, "people manage their own avatar" and "owners manage their company logo" from 309, and drop the policies this file creates
-- safety: drop — admin_moderate_job and admin_review_company are re-created in this file with a fourth argument that defaults to null, so every call written for three arguments (the website's, admin_decide_appeal's, admin_moderate_reports') resolves to the new function unchanged
-- safety: rls — reports_admin is split into read, file and update, the same rights less delete, which no console lever uses; each storage policy is restated with the same bucket and folder rule and one condition added, or split into the commands the website and the app use: no client writes a CV, a paper, a photo or a logo in place (all upload with upsert off, photos and logos through the server's service role), and no client deletes a CV something points at
-- safety: ships-with-code — the website sends a version to the review functions only after reading PGRST202 as "not migrated" and retrying without it, closes a deletion request through the new function with the same fallback, and nothing else in src/ needs this file; every function keeps its result type

-- ---------------------------------------------------------------------------
-- 1. Each leased email its own token
-- ---------------------------------------------------------------------------

create or replace function public.lease_due_emails(
  p_limit         integer default 25,
  p_lease_seconds integer default 120
)
returns table (id uuid, template text, entity_id uuid, user_id uuid, attempts smallint, lock_token uuid)
language sql
security definer
set search_path = public
as $$
  with due as (
    select e.id
      from email_log e
     where e.status in ('queued', 'failed')
       and e.gave_up_at is null
       and e.next_attempt_at <= now()
       and (e.locked_until is null or e.locked_until < now())
       and e.leases < 8
       and greatest(e.created_at, coalesce(e.requeued_at, e.created_at)) > now() - interval '3 days'
     order by e.next_attempt_at
     limit least(greatest(p_limit, 1), 100)
       for update skip locked
  )
  update email_log e
     set lock_token   = gen_random_uuid(),
         locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         leases       = e.leases + 1
    from due
   where e.id = due.id
  returning e.id, e.template, e.entity_id, e.user_id, e.attempts, e.lock_token;
$$;

-- ---------------------------------------------------------------------------
-- 2. A verified company's new name is checked like anybody's
-- ---------------------------------------------------------------------------

create or replace function public.flag_company_text()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_high   jsonb;
  v_reason text;
  v_detail text;
  v_like   jsonb;
begin
  if public.acting_as_admin() then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.name_ar, new.name_en, new.about_ar, new.about_en, new.website)
         is not distinct from (old.name_ar, old.name_en, old.about_ar, old.about_en, old.website) then
    return null;
  end if;

  select coalesce(jsonb_agg(f), '[]'::jsonb) into v_high
    from jsonb_array_elements(public.company_safety_flags(new.id)) f
   where f ->> 'weight' = 'high';

  -- company_safety_flags leaves a verified company's name alone: verification
  -- settled who it is. It settled the name the company had then, though, and a
  -- verified company may rename itself. A new name that borrows a developer's
  -- or another verified company's — one the old name did not — goes to the
  -- queue like anybody else's, with the badge it would otherwise lend.
  if tg_op = 'UPDATE' and new.verification_status = 'verified' then
    if (new.name_ar, new.name_en) is distinct from (old.name_ar, old.name_en) then
      v_like := public.company_name_resemblance(new.id, new.name_ar, new.name_en);
      if v_like is not null
         and public.company_name_resemblance(new.id, old.name_ar, old.name_en) is distinct from v_like
         and not v_high @> '[{"flag": "impersonation"}]' then
        v_high := v_high || jsonb_build_array(jsonb_build_object(
          'flag', 'impersonation', 'weight', 'high',
          'evidence', v_like ->> 'name', 'kind', v_like ->> 'kind'));
      end if;
    end if;
  end if;

  if jsonb_array_length(v_high) = 0 then
    return null;
  end if;

  v_reason := case
    when v_high @> '[{"flag": "impersonation"}]' then 'impersonation'
    when v_high @> '[{"flag": "asks_for_money"}]' or v_high @> '[{"flag": "asks_for_documents"}]' then 'scam'
    else 'suspicious_company'
  end;

  select string_agg((f ->> 'flag') || ': ' || coalesce(f ->> 'evidence', ''), ' · ')
    into v_detail
    from jsonb_array_elements(v_high) f;

  perform public.raise_system_report('company', new.id, v_reason, v_detail);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. An appeal reverses the decision it was about, and only that
--
-- appeal_decision_state() reads the subject as it is now against the decision
-- the appeal was filed on:
--
--   same      that decision is still the one in force
--   lifted    nothing is in force any more (lifted by hand, or the employer
--             resubmitted the listing)
--   replaced  a later decision is in force (suspended again, held and then
--             suspended, a listing re-decided)
--   edited    the listing is still refused, but its text changed since
-- ---------------------------------------------------------------------------

create or replace function public.appeal_decision_snapshot(
  p_user         uuid,
  p_subject_type text,
  p_subject_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  if p_user is null then
    return null;
  end if;

  if p_subject_type = 'job' then
    select jsonb_build_object('status', j.status, 'note', j.rejection_note,
                              'label_ar', j.title_ar, 'label_en', j.title_en, 'company_id', j.company_id,
                              'version', j.version)
      into v_snapshot
      from jobs j
     where j.id = p_subject_id
       and j.status = 'rejected'
       and exists (select 1 from company_members m where m.company_id = j.company_id and m.user_id = p_user);

  elsif p_subject_type = 'company' then
    select jsonb_build_object('suspended_at', c.suspended_at, 'note', cm.suspension_reason,
                              'label_ar', c.name_ar, 'label_en', c.name_en)
      into v_snapshot
      from companies c
      left join company_moderation cm on cm.company_id = c.id
     where c.id = p_subject_id
       and c.suspended_at is not null
       and exists (select 1 from company_members m where m.company_id = c.id and m.user_id = p_user);

  elsif p_subject_type = 'account' then
    -- Suspended, or held by a moderator — not the first review every new
    -- employer waits for, which is also "pending" but was never a decision.
    select jsonb_build_object('status', p.approval_status, 'label_ar', p.full_name, 'label_en', p.full_name)
      into v_snapshot
      from profiles p
     where p.id = p_subject_id
       and p.id = p_user
       and (p.approval_status = 'rejected'
            or (p.approval_status = 'pending'
                and (select a.action from admin_audit_log a
                      where a.target_type = 'user' and a.target_id = p.id::text
                        and a.action in ('user.approved', 'user.held', 'user.suspended', 'user.restored')
                      order by a.created_at desc, a.id desc
                      limit 1) = 'user.held'));

  elsif p_subject_type = 'agent' then
    select jsonb_build_object('restricted_at', a.restricted_at, 'note', a.restriction_reason,
                              'label_ar', a.slug, 'label_en', a.slug)
      into v_snapshot
      from agent_profiles a
     where a.id = p_subject_id
       and a.user_id = p_user
       and a.restricted_at is not null;
  end if;

  return v_snapshot;
end;
$$;

create or replace function public.appeal_decision_state(p_appeal moderation_appeals)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_snap jsonb := p_appeal.decision_snapshot;
  v_job  jobs%rowtype;
begin
  if p_appeal.subject_type = 'job' then
    select * into v_job from jobs where id = p_appeal.subject_id;
    if not found or v_job.status <> 'rejected' then
      return 'lifted';
    end if;
    if exists (select 1 from admin_audit_log l
                where l.target_type = 'job' and l.target_id = p_appeal.subject_id::text
                  and l.action in ('job.approve', 'job.restore', 'job.reject', 'job.request_changes', 'job.unpublish')
                  and l.created_at > p_appeal.created_at) then
      return 'replaced';
    end if;
    -- Appeals filed before this migration carry no version; for those the
    -- decisions above are all that can be told.
    if v_snap ? 'version' and v_job.version <> (v_snap ->> 'version')::int then
      return 'edited';
    end if;
    return 'same';

  elsif p_appeal.subject_type = 'company' then
    return coalesce((
      select case
               when c.suspended_at is null then 'lifted'
               when c.suspended_at is distinct from (v_snap ->> 'suspended_at')::timestamptz then 'replaced'
               else 'same'
             end
        from companies c
       where c.id = p_appeal.subject_id), 'lifted');

  elsif p_appeal.subject_type = 'agent' then
    return coalesce((
      select case
               when a.restricted_at is null then 'lifted'
               when a.restricted_at is distinct from (v_snap ->> 'restricted_at')::timestamptz then 'replaced'
               else 'same'
             end
        from agent_profiles a
       where a.id = p_appeal.subject_id), 'lifted');

  elsif p_appeal.subject_type = 'account' then
    return coalesce((
      select case
               when p.approval_status = 'approved' then 'lifted'
               -- Held then and suspended now, or the other way round.
               when p.approval_status::text is distinct from v_snap ->> 'status' then 'replaced'
               -- The same state, decided again since: suspended, restored and
               -- suspended once more.
               when exists (select 1 from admin_audit_log l
                             where l.target_type = 'user' and l.target_id = p.id::text
                               and l.action in ('user.approved', 'user.held', 'user.suspended', 'user.restored')
                               and l.created_at > p_appeal.created_at) then 'replaced'
               else 'same'
             end
        from profiles p
       where p.id = p_appeal.subject_id), 'lifted');
  end if;

  return 'lifted';
end;
$$;

revoke execute on function public.appeal_decision_state(moderation_appeals) from public, anon, authenticated;

create or replace function public.admin_decide_appeal(
  p_appeal   uuid,
  p_overturn boolean,
  p_note     text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appeal     moderation_appeals%rowtype;
  v_note       text;
  v_acted      boolean := false;
  v_outcome    text;
  v_label      text;
  v_audit_type text;
  v_href       text;
  v_state      text;
  v_restore    constant text := 'رُفع القرار بعد مراجعة الاعتراض';
begin
  perform public.admin_begin();

  select * into v_appeal from moderation_appeals where id = p_appeal for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_appeal.status <> 'open' then
    raise exception 'invalid_transition' using hint = 'This appeal has already been answered.';
  end if;

  -- Upholding needs a reason: the person asked why, and "no" is not one.
  v_note := public.admin_reason(p_note, not p_overturn, 1000);

  if p_overturn then
    v_state := public.appeal_decision_state(v_appeal);

    -- Restoring now would publish text nobody has reviewed: the listing was
    -- edited after it was appealed. Its page shows it as it is, and restores
    -- it from there once read.
    if v_state = 'edited' then
      raise exception 'invalid_transition'
        using hint = 'The listing was edited after this appeal was made. Read it as it is now on its page, and restore it from there if it should be live.';
    end if;

    -- Reversed only if the decision appealed is the one still in force. One
    -- somebody already lifted by hand is answered without doing it twice; one
    -- a later decision replaced — a hold lifted and the account suspended
    -- since, for something else — is answered without touching that later
    -- decision, which this appeal never asked about.
    if v_state = 'same' then
      if v_appeal.subject_type = 'job' then
        perform public.admin_moderate_job(v_appeal.subject_id, 'restore', v_note,
                                          (v_appeal.decision_snapshot ->> 'version')::int);
      elsif v_appeal.subject_type = 'company' then
        perform public.admin_set_company_suspension(v_appeal.subject_id, false, coalesce(v_note, v_restore));
      elsif v_appeal.subject_type = 'account' then
        perform public.set_account_approval(v_appeal.subject_id, 'approved', v_note);
      else
        perform public.admin_set_agent_restriction(v_appeal.subject_id, false, coalesce(v_note, v_restore));
      end if;
      v_acted := true;
    end if;
  end if;

  v_outcome := case when p_overturn then 'overturned' else 'upheld' end;

  update moderation_appeals
     set status = v_outcome,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = v_note
   where id = p_appeal;

  v_audit_type := case v_appeal.subject_type when 'account' then 'user' else v_appeal.subject_type end;
  v_label := coalesce(v_appeal.decision_snapshot ->> 'label_ar', v_appeal.subject_id::text);

  perform public.admin_audit(
    v_audit_type || '.appeal_' || v_outcome, v_audit_type, v_appeal.subject_id::text, v_label, v_note,
    jsonb_build_object('appeal_id', v_appeal.id, 'reversed', v_acted, 'decision', v_state));

  v_href := case v_appeal.subject_type
              when 'job'     then '/employer/jobs'
              when 'company' then '/employer'
              when 'agent'   then '/dashboard/profile'
              else (select case when role = 'employer' then '/employer' else '/dashboard' end
                      from profiles where id = v_appeal.appellant_id)
            end;

  perform public.moderation_notify(
    v_appeal.appellant_id,
    'appeal_decided',
    jsonb_build_object(
      'subject_type', v_appeal.subject_type,
      'outcome',      v_outcome,
      'title_ar',     v_appeal.decision_snapshot ->> 'label_ar',
      'title_en',     v_appeal.decision_snapshot ->> 'label_en',
      'note',         v_note),
    v_href);

  return v_outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Approve and verify act on what the page showed
-- ---------------------------------------------------------------------------

drop function if exists public.admin_moderate_job(uuid, text, text);

create or replace function public.admin_moderate_job(
  p_job     uuid,
  p_action  text,
  p_reason  text default null,
  p_version int  default null
)
returns job_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job    jobs%rowtype;
  v_next   job_status;
  v_reason text;
begin
  perform public.admin_begin();

  select * into v_job from jobs where id = p_job for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- The listing the moderator read, or none: the page sends the version it
  -- showed, and an edit since then is refused rather than approved unseen.
  if p_version is not null and v_job.version <> p_version then
    raise exception 'stale_version'
      using hint = 'This listing changed after the page was opened. Reload it and read it again.';
  end if;

  v_reason := public.admin_reason(p_reason, p_action in ('reject', 'request_changes', 'unpublish', 'close'));

  if p_action = 'approve' and v_job.status = 'pending_review' then
    v_next := 'active';
  elsif p_action = 'restore' and v_job.status = 'rejected' then
    v_next := 'active';
  elsif p_action in ('reject', 'request_changes') and v_job.status = 'pending_review' then
    v_next := 'rejected';
  elsif p_action = 'unpublish' and v_job.status = 'active' then
    v_next := 'rejected';
  elsif p_action = 'close' and v_job.status in ('active', 'expired') then
    v_next := 'closed';
  elsif p_action not in ('approve', 'restore', 'reject', 'request_changes', 'unpublish', 'close') then
    raise exception 'invalid_action';
  else
    raise exception 'invalid_transition'
      using hint = format('A %s listing cannot be %s.', v_job.status, p_action);
  end if;

  update jobs
     set status = v_next,
         rejection_note = case
           when v_next = 'rejected' then v_reason
           when v_next = 'active'   then null
           else rejection_note
         end
   where id = p_job;

  perform public.admin_audit(
    'job.' || p_action, 'job', p_job::text, v_job.title_ar, v_reason,
    jsonb_build_object('from', v_job.status, 'to', v_next, 'company_id', v_job.company_id));

  return v_next;
end;
$$;

revoke execute on function public.admin_moderate_job(uuid, text, text, int) from public, anon;
grant  execute on function public.admin_moderate_job(uuid, text, text, int) to authenticated;

drop function if exists public.admin_review_company(uuid, text, text);

create or replace function public.admin_review_company(
  p_company  uuid,
  p_decision text,
  p_note     text default null,
  p_version  int  default null
)
returns verification_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company companies%rowtype;
  v_next    verification_status;
  v_note    text;
  v_docs    int := 0;
begin
  perform public.admin_begin();

  select * into v_company from companies where id = p_company for update;
  if not found then
    raise exception 'not_found';
  end if;

  -- As for listings: the company the reviewer read, not one renamed since.
  if p_version is not null and v_company.version <> p_version then
    raise exception 'stale_version'
      using hint = 'This company changed after the page was opened. Reload it and read it again.';
  end if;

  v_note := public.admin_reason(p_note, p_decision <> 'verify');

  if p_decision = 'verify' and v_company.verification_status <> 'verified' then
    v_next := 'verified';
  elsif p_decision = 'reject' and v_company.verification_status in ('pending', 'unverified') then
    v_next := 'rejected';
  elsif p_decision = 'request_changes' and v_company.verification_status = 'pending' then
    v_next := 'unverified';
  elsif p_decision = 'revoke' and v_company.verification_status = 'verified' then
    v_next := 'unverified';
  elsif p_decision not in ('verify', 'reject', 'request_changes', 'revoke') then
    raise exception 'invalid_action';
  else
    raise exception 'invalid_transition'
      using hint = format('A %s company cannot be given %s.', v_company.verification_status, p_decision);
  end if;

  update companies
     set verification_status = v_next,
         verified_at = case when v_next = 'verified' then now() else null end
   where id = p_company;

  if p_decision <> 'revoke' then
    update company_documents
       set status = case when p_decision = 'verify' then 'verified' else 'rejected' end::verification_status,
           review_note = v_note,
           reviewed_by = auth.uid(),
           reviewed_at = now()
     where company_id = p_company and status = 'pending';
    get diagnostics v_docs = row_count;
  end if;

  perform public.admin_audit(
    'company.' || p_decision, 'company', p_company::text, v_company.name_ar, v_note,
    jsonb_build_object('from', v_company.verification_status, 'to', v_next, 'documents', v_docs));

  return v_next;
end;
$$;

revoke execute on function public.admin_review_company(uuid, text, text, int) from public, anon;
grant  execute on function public.admin_review_company(uuid, text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reports: kept, told truthfully, counted
--
-- No console lever deletes a report; reports_admin is FOR ALL, so an admin
-- could, through the API, and nothing recorded it. Deleting is taken away
-- (a deleted listing's reports stay, migration 326; retention removes old ones
-- as the table's owner) and a direct edit is audited like one to a listing.
-- ---------------------------------------------------------------------------

revoke delete on table reports from anon, authenticated;

-- reports_admin (migration 4) was FOR ALL: the same rights, less the delete.
drop policy if exists reports_admin on reports;

drop policy if exists reports_admin_read on reports;
create policy reports_admin_read on reports
  for select using ((select public.is_admin()));

drop policy if exists reports_admin_file on reports;
create policy reports_admin_file on reports
  for insert with check ((select public.is_admin()));

drop policy if exists reports_admin_update on reports;
create policy reports_admin_update on reports
  for update using ((select public.is_admin())) with check ((select public.is_admin()));

drop trigger if exists reports_90_audit_direct_admin_write on reports;
create trigger reports_90_audit_direct_admin_write
  after update or delete on reports
  for each row execute function public.audit_direct_admin_write(
    'report', 'reason', 'status', 'abusive', 'resolved_by');

create or replace function public.tell_reporter_outcome()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_down boolean;
begin
  if new.source <> 'user' or new.reporter_id is null then
    return null;
  end if;
  if not (old.status in ('open', 'investigating') and new.status in ('resolved', 'dismissed')) then
    return null;
  end if;

  -- "We acted on it" only when the thing reported is down: taken down by this
  -- resolution or before it. "Resolved, nothing taken down" is a review.
  v_down := new.status = 'resolved' and case new.target_type
    when 'job'     then exists (select 1 from jobs j where j.id = new.target_id and j.status = 'rejected')
    when 'company' then exists (select 1 from companies c where c.id = new.target_id and c.suspended_at is not null)
    when 'agent'   then exists (select 1 from agent_profiles a where a.id = new.target_id and a.restricted_at is not null)
    else false
  end;

  perform public.moderation_notify(
    new.reporter_id,
    'report_reviewed',
    jsonb_build_object(
      'target_type', new.target_type,
      'title_ar',    new.target_snapshot ->> 'label_ar',
      'title_en',    new.target_snapshot ->> 'label_en',
      'outcome',     case when v_down then 'actioned' else 'reviewed' end),
    null);
  return null;
end;
$$;

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_jobs      jsonb;
  v_apps      jsonb;
  v_companies jsonb;
  v_accounts  jsonb;
  v_agents    jsonb;
  v_reports   jsonb;
  v_recent    jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'live',           count(*) filter (where status = 'active' and expires_at > now()),
    'pending',        count(*) filter (where status = 'pending_review'),
    'pending_24h',    count(*) filter (where status = 'pending_review' and created_at < now() - interval '24 hours'),
    'expired',        count(*) filter (where status = 'expired' or (status = 'active' and expires_at <= now())),
    'closed',         count(*) filter (where status = 'closed'),
    'rejected',       count(*) filter (where status = 'rejected'),
    'draft',          count(*) filter (where status = 'draft'),
    'expiring_7d',    count(*) filter (where status = 'active' and expires_at > now() and expires_at <= now() + interval '7 days'),
    'featured',       count(*) filter (where is_featured and status = 'active' and expires_at > now()),
    'live_no_applicants', count(*) filter (
       where status = 'active' and expires_at > now()
         and published_at < now() - interval '3 days'
         and not exists (select 1 from applications a where a.job_id = jobs.id))
  ) into v_jobs from jobs;

  select jsonb_build_object(
    'total',        count(*),
    'last_7d',      count(*) filter (where created_at > now() - interval '7 days'),
    'prev_7d',      count(*) filter (where created_at <= now() - interval '7 days' and created_at > now() - interval '14 days'),
    -- Waiting on an employer for more than a week without being opened.
    'unopened_7d',  count(*) filter (where status = 'new' and employer_viewed_at is null and created_at < now() - interval '7 days')
  ) into v_apps from applications;

  select jsonb_build_object(
    'total',      count(*),
    'hiring',     count(*) filter (where exists (
                     select 1 from jobs j where j.company_id = companies.id
                        and j.status = 'active' and j.expires_at > now())),
    'pending',    count(*) filter (where verification_status = 'pending'),
    'verified',   count(*) filter (where verification_status = 'verified'),
    'suspended',  count(*) filter (where suspended_at is not null)
  ) into v_companies from companies;

  select jsonb_build_object(
    'candidates', count(*) filter (where role = 'candidate'),
    'employers',  count(*) filter (where role = 'employer'),
    'admins',     count(*) filter (where role = 'admin'),
    'pending',    count(*) filter (where approval_status = 'pending'),
    'suspended',  count(*) filter (where approval_status = 'rejected'),
    'signups_7d', count(*) filter (where created_at > now() - interval '7 days')
  ) into v_accounts from profiles;

  select jsonb_build_object(
    'total',      count(*),
    'public',     count(*) filter (where visibility = 'public'),
    'gated',      count(*) filter (where visibility = 'verified_employers_only'),
    'hidden',     count(*) filter (where visibility = 'hidden' and restricted_at is null),
    'restricted', count(*) filter (where restricted_at is not null)
  ) into v_agents from agent_profiles;

  select jsonb_build_object(
    'open_targets',  count(distinct (target_type, target_id)) filter (where status in ('open', 'investigating')),
    'open_jobs',     count(distinct job_id) filter (where status in ('open', 'investigating')),
    'open_companies',count(distinct company_id) filter (where status in ('open', 'investigating')),
    'open_agents',   count(distinct agent_id) filter (where status in ('open', 'investigating')),
    'investigating', count(*) filter (where status = 'investigating'),
    'last_7d',       count(*) filter (where created_at > now() - interval '7 days')
  ) into v_reports from reports;

  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
    into v_recent
    from (
      select id, actor_name, action, target_type, target_id, target_label, via, created_at
        from admin_audit_log
       order by created_at desc
       limit 8
    ) r;

  return jsonb_build_object(
    'jobs', v_jobs, 'applications', v_apps, 'companies', v_companies,
    'accounts', v_accounts, 'agents', v_agents, 'reports', v_reports,
    'recent', v_recent, 'generated_at', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The console's account search, as people spell names
-- ---------------------------------------------------------------------------

create or replace function public.admin_search_users(
  p_query  text default null,
  p_role   user_role default null,
  p_status approval_status default null,
  p_limit  int default 25,
  p_offset int default 0
)
returns table (
  id               uuid,
  role             user_role,
  full_name        text,
  avatar_url       text,
  approval_status  approval_status,
  approval_note    text,
  created_at       timestamptz,
  company_id       uuid,
  company_name_ar  text,
  company_name_en  text,
  agent_slug       text,
  agent_restricted boolean,
  total_count      bigint
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_q      text := nullif(btrim(p_query), '');
  v_uuid   uuid;
  v_email  uuid;
  v_digits text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_q::uuid;
  end if;
  if position('@' in coalesce(v_q, '')) > 0 then
    select u.id into v_email from auth.users u where lower(u.email) = lower(v_q) limit 1;
  end if;
  if v_q ~ '^[+0-9 ()-]+$' then
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    if length(v_digits) < 6 then v_digits := null; end if;
    -- Stored as +20…; somebody pastes 010…, so drop a leading zero.
    v_digits := regexp_replace(v_digits, '^0', '');
  end if;

  return query
    select p.id, p.role, p.full_name, p.avatar_url, p.approval_status, pp.approval_note,
           p.created_at, c.id, c.name_ar, c.name_en, a.slug, a.restricted_at is not null,
           count(*) over ()
      from profiles p
      left join profile_private pp on pp.user_id = p.id
      left join lateral (
        select co.id, co.name_ar, co.name_en
          from company_members m
          join companies co on co.id = m.company_id
         where m.user_id = p.id
         order by (m.role = 'admin') desc, m.created_at
         limit 1
      ) c on true
      left join agent_profiles a on a.user_id = p.id
     where (p_role is null or p.role = p_role)
       and (p_status is null or p.approval_status = p_status)
       and (
         v_q is null
         or (v_uuid is not null and p.id = v_uuid)
         or (v_email is not null and p.id = v_email)
         or (v_digits is not null and p.whatsapp_phone like '%' || v_digits || '%')
         or p.full_name ilike public.admin_like_pattern(v_q)
         or public.ar_normalise(p.full_name) ilike public.admin_like_pattern(public.ar_normalise(v_q))
       )
     order by (p.approval_status = 'pending') desc, p.created_at desc, p.id desc
     limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. An account deletion request: from the account, and closed on the record
-- ---------------------------------------------------------------------------

create or replace function public.guard_account_deletion_request()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- The overview reads a request with no account as "already deleted"; filed
  -- signed out, a stranger's request read as done.
  if new.topic = 'account_deletion' and new.user_id is null then
    raise exception 'sign_in_required'
      using hint = 'A request to delete an account comes from that account, signed in.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_account_deletion_request() from public, anon, authenticated;

drop trigger if exists support_requests_05_deletion_needs_account on support_requests;
create trigger support_requests_05_deletion_needs_account
  before insert on support_requests
  for each row execute function public.guard_account_deletion_request();

create or replace function public.admin_close_deletion_request(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row support_requests%rowtype;
begin
  perform public.admin_begin();

  select * into v_row from support_requests where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_row.topic <> 'account_deletion' then
    raise exception 'invalid_action' using hint = 'Only an account deletion request is closed here.';
  end if;
  if v_row.status = 'closed' then
    raise exception 'no_change' using hint = 'This request is already closed.';
  end if;

  update support_requests
     set status = 'closed', updated_at = now()
   where id = p_id;

  -- A request answered by closing it has no reply, so replied_by stays empty;
  -- this is the record of who closed it, and when.
  perform public.admin_audit(
    'user.deletion_request_closed', 'user', coalesce(v_row.user_id::text, v_row.reference), v_row.reference, null,
    jsonb_build_object('request_id', v_row.id, 'account_deleted', v_row.user_id is null));

  return 'closed';
end;
$$;

revoke execute on function public.admin_close_deletion_request(uuid) from public, anon;
grant  execute on function public.admin_close_deletion_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Files stay as they were checked
-- ---------------------------------------------------------------------------

-- Papers. A path a reviewed row names is not the company's to fill again —
-- the server's byte check removes a file that fails it, and the reviewed row
-- would then have named whatever came next. Nothing replaces a paper in place
-- any more (both clients upload with upsert off), and the cap counts the
-- papers the company can still take back, not the reviewed ones it cannot.

create or replace function public.company_documents_open_count(p_folder text)
returns int
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if auth.uid() is null or p_folder is null
     or p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 0;
  end if;
  if not (public.is_admin() or public.is_company_admin(p_folder::uuid)) then
    return 0;
  end if;

  return (
    select count(*)::int
      from storage.objects o
     where o.bucket_id = 'company-documents'
       and o.name like p_folder || '/%'
       and not exists (select 1 from company_documents d
                        where d.storage_path = o.name and d.status <> 'pending')
  );
end;
$$;

-- Not anon's: only an insert calls it, and a signed-out caller cannot add a
-- paper anyway — refused here by the grant instead of by the policy.
revoke execute on function public.company_documents_open_count(text) from public, anon;
grant  execute on function public.company_documents_open_count(text) to authenticated, service_role;

drop policy if exists "owners add verification documents" on storage.objects;
create policy "owners add verification documents"
  on storage.objects for insert
  with check (
    bucket_id = 'company-documents'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
    and not public.company_document_reviewed(name)
    and public.company_documents_open_count((storage.foldername(name))[1]) < 20
  );

drop policy if exists "owners replace unreviewed verification documents" on storage.objects;

-- CVs. Read, added and removed, never rewritten: the bytes an employer opens
-- are the bytes the server checked. A CV an application or the profile
-- points at is the employer's record of what was sent (migration 42) and the
-- profile's file; withdrawing, or taking the CV off the profile, lets it go.

create or replace function public.cv_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and split_part(coalesce(p_name, ''), '/', 1) = auth.uid()::text
     and (exists (select 1 from applications   where cv_path = p_name)
          or exists (select 1 from agent_profiles where cv_path = p_name));
$$;

-- As above: only a delete calls it, and a signed-out caller has no folder.
revoke execute on function public.cv_in_use(text) from public, anon;
grant  execute on function public.cv_in_use(text) to authenticated, service_role;

drop policy if exists "candidates manage their own cv" on storage.objects;

drop policy if exists "candidates read their own cv" on storage.objects;
create policy "candidates read their own cv"
  on storage.objects for select
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "candidates add their own cv" on storage.objects;
create policy "candidates add their own cv"
  on storage.objects for insert
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.storage_folder_loose_count('cvs', auth.uid()::text) < 20
  );

drop policy if exists "candidates remove their own unused cv" on storage.objects;
create policy "candidates remove their own unused cv"
  on storage.objects for delete
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.cv_in_use(name)
  );

-- Photos and logos. Written by the server only (src/lib/actions/uploads.ts,
-- with the service role), after it has decoded the picture and written it
-- again without what was not pixels — the phone's location among it. An
-- owner's own write skipped all of that and was served from a public URL.
-- Owners keep seeing and removing their own.

drop policy if exists "people manage their own avatar" on storage.objects;

drop policy if exists "people see their own avatars" on storage.objects;
create policy "people see their own avatars"
  on storage.objects for select
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "people remove their own avatars" on storage.objects;
create policy "people remove their own avatars"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "owners manage their company logo" on storage.objects;

drop policy if exists "owners see their company logos" on storage.objects;
create policy "owners see their company logos"
  on storage.objects for select
  using (
    bucket_id = 'company-logos'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "owners remove their company logos" on storage.objects;
create policy "owners remove their company logos"
  on storage.objects for delete
  using (
    bucket_id = 'company-logos'
    and public.is_company_admin((storage.foldername(name))[1]::uuid)
  );
