-- =============================================================================
-- 316 — Every lever through one door
--
-- The console's server actions wrote tables directly under the admin's
-- session: `update jobs set status = 'active'`, then an email. That made the
-- admin RLS policies the whole of the rule — which transitions are sensible,
-- whether a reason is needed, whether anybody is told — and left every rule
-- about *moderation* in TypeScript, where a second caller would not see it.
--
-- Each lever is now one SECURITY DEFINER function that, in one transaction:
--
--   1. refuses anybody who is not an admin          (admin_begin)
--   2. locks the row it is about to change          (select … for update)
--   3. refuses a transition that makes no sense     ('invalid_transition')
--   4. requires a reason where somebody is owed one ('reason_required')
--   5. makes the change, through the same triggers every other writer meets
--      — the post cap, the credit, the suspension check still apply
--   6. writes the audit record                      (admin_audit, migration 314)
--
-- Because it is one transaction, a decision without a record, or a record of
-- a decision that failed, cannot exist. And because the row is locked before
-- its state is read, two moderators pressing the same button converge: the
-- second one is told the listing has already moved, rather than both
-- succeeding and the employer being emailed twice.
--
-- Error words are stable identifiers (not_found, invalid_transition,
-- reason_required, …) that the console maps to sentences; the hint carries
-- detail for a person reading logs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Shared preamble
-- ---------------------------------------------------------------------------

create or replace function public.admin_begin()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Tells migration 314's safety net that this write is already being audited.
  perform set_config('app.admin_console', 'on', true);
  return auth.uid();
end;
$$;

revoke execute on function public.admin_begin() from public, anon, authenticated;

create or replace function public.admin_reason(p_reason text, p_required boolean, p_max int default 500)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := nullif(btrim(p_reason), '');
begin
  if p_required and (v is null or length(v) < 3) then
    raise exception 'reason_required' using hint = 'This action needs a reason of at least three characters.';
  end if;
  if length(v) > p_max then
    raise exception 'reason_too_long' using hint = format('Keep the reason under %s characters.', p_max);
  end if;
  return v;
end;
$$;

revoke execute on function public.admin_reason(text, boolean, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Listings
--
--   approve          pending_review -> active
--   reject           pending_review -> rejected   (reason)
--   request_changes  pending_review -> rejected   (reason; the employer's
--                                                  notification already reads
--                                                  "needs changes")
--   unpublish        active         -> rejected   (reason; a takedown)
--   close            active|expired -> closed     (reason; on the employer's
--                                                  behalf)
--   restore          rejected       -> active     (undo a takedown; the cap,
--                                                  credit and suspension rules
--                                                  apply as to any approval)
--
-- Nothing may move a listing into draft (that is the employer's workspace) or
-- out of closed (the employer's own word that the role is filled — they
-- repost it themselves if it is not).
-- ---------------------------------------------------------------------------

create or replace function public.admin_moderate_job(
  p_job    uuid,
  p_action text,
  p_reason text default null
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

create or replace function public.admin_set_job_featured(p_job uuid, p_featured boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job jobs%rowtype;
begin
  perform public.admin_begin();

  select * into v_job from jobs where id = p_job for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_job.is_featured = p_featured then
    raise exception 'no_change';
  end if;
  if p_featured and not (v_job.status = 'active' and v_job.expires_at > now()) then
    raise exception 'invalid_transition' using hint = 'Only a live listing can be featured.';
  end if;

  update jobs
     set is_featured = p_featured,
         featured_until = case when p_featured then now() + interval '14 days' else null end
   where id = p_job;

  perform public.admin_audit(
    case when p_featured then 'job.featured' else 'job.unfeatured' end,
    'job', p_job::text, v_job.title_ar, null, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Company verification
--
--   verify           anything but verified -> verified   (pending papers are
--                                                          marked verified)
--   reject           pending|unverified    -> rejected   (reason)
--   request_changes  pending               -> unverified (reason; the papers
--                                                          are marked rejected
--                                                          with it, so the
--                                                          owner sees why and
--                                                          uploads again)
--   revoke           verified              -> unverified (reason)
-- ---------------------------------------------------------------------------

create or replace function public.admin_review_company(
  p_company  uuid,
  p_decision text,
  p_note     text default null
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

-- ---------------------------------------------------------------------------
-- Company suspension
--
-- Suspending takes every live and waiting listing down (rejected, with the
-- reason, which is what the employer's screens already explain) and the
-- trigger in migration 315 keeps anything new off the board. Restoring lifts
-- the switch and deliberately brings nothing back: which listings deserve to
-- return is a decision per listing, made with the restore action above.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_company_suspension(
  p_company uuid,
  p_suspend boolean,
  p_reason  text default null
)
returns int
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
    update companies
       set suspended_at = now(), suspension_reason = v_reason
     where id = p_company;

    update jobs
       set status = 'rejected', rejection_note = v_reason
     where company_id = p_company and status in ('active', 'pending_review');
    get diagnostics v_down = row_count;
  else
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

-- ---------------------------------------------------------------------------
-- Consultant restriction
--
-- Restricting hides the profile from the directory and from every employer,
-- and migration 315 keeps it hidden through the consultant's own saves.
-- Lifting it leaves visibility at hidden: whether to be seen again is the
-- consultant's choice, not something an admin makes for them.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_agent_restriction(
  p_agent    uuid,
  p_restrict boolean,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent  agent_profiles%rowtype;
  v_reason text;
begin
  perform public.admin_begin();

  select * into v_agent from agent_profiles where id = p_agent for update;
  if not found then
    raise exception 'not_found';
  end if;

  v_reason := public.admin_reason(p_reason, true);

  if p_restrict = (v_agent.restricted_at is not null) then
    raise exception 'no_change';
  end if;

  if p_restrict then
    update agent_profiles
       set restricted_at = now(), restriction_reason = v_reason, visibility = 'hidden'
     where id = p_agent;
  else
    update agent_profiles
       set restricted_at = null, restriction_reason = null
     where id = p_agent;
  end if;

  perform public.admin_audit(
    case when p_restrict then 'agent.restricted' else 'agent.restored' end,
    'agent', p_agent::text, v_agent.slug, v_reason,
    jsonb_build_object('visibility_before', v_agent.visibility));
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts
--
-- Restated whole from migration 33, keeping every rule it had, and adding:
-- the row is locked and a no-op is refused (so a double click cannot email
-- somebody twice), a suspension needs a reason, and the decision is recorded.
-- ---------------------------------------------------------------------------

create or replace function public.set_account_approval(
  p_user   uuid,
  p_status approval_status,
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public
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

  v_note := public.admin_reason(p_note, p_status = 'rejected');

  update profiles
     set approval_status = p_status,
         approval_note   = v_note,
         approved_at     = case when p_status = 'approved' then now() else null end
   where id = p_user;

  if p_status = 'rejected' then
    /*
      The profile above is already suspended by the time this runs, so the
      "is anybody else still approved" test does not need to exclude the target
      by status — but it does exclude them by id, because a company whose only
      member has just been suspended must not count that member as cover for
      itself.
    */
    update jobs
       set status = 'rejected',
           rejection_note = coalesce(v_note, 'الحساب موقوف')
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

-- ---------------------------------------------------------------------------
-- Reports, handled per target
--
-- The unit of work is the thing reported, not the row: every open report on
-- one listing (or company, or consultant) moves together. `p_take_action`
-- does the matching takedown in the same transaction — a listing is taken off
-- the board, a company suspended, a consultant restricted — so "resolved,
-- acted on" cannot be recorded while the harm stays up.
-- ---------------------------------------------------------------------------

create or replace function public.admin_moderate_reports(
  p_target_type text,
  p_target_id   uuid,
  p_status      text,
  p_note        text default null,
  p_take_action boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note   text;
  v_moved  int := 0;
  v_acted  boolean := false;
  v_label  text;
  v_status job_status;
begin
  perform public.admin_begin();

  if p_target_type not in ('job', 'company', 'agent') then
    raise exception 'invalid_action';
  end if;
  if p_status not in ('investigating', 'resolved', 'dismissed') then
    raise exception 'invalid_action';
  end if;
  if p_take_action and p_status <> 'resolved' then
    raise exception 'invalid_action' using hint = 'Only a resolution can take action.';
  end if;

  v_note := public.admin_reason(p_note, p_take_action);

  if p_take_action then
    if p_target_type = 'job' then
      select status, title_ar into v_status, v_label from jobs where id = p_target_id;
      if v_status = 'active' then
        perform public.admin_moderate_job(p_target_id, 'unpublish', v_note);
        v_acted := true;
      elsif v_status = 'pending_review' then
        perform public.admin_moderate_job(p_target_id, 'reject', v_note);
        v_acted := true;
      end if;
    elsif p_target_type = 'company' then
      if exists (select 1 from companies where id = p_target_id and suspended_at is null) then
        perform public.admin_set_company_suspension(p_target_id, true, v_note);
        v_acted := true;
      end if;
    else
      if exists (select 1 from agent_profiles where id = p_target_id and restricted_at is null) then
        perform public.admin_set_agent_restriction(p_target_id, true, v_note);
        v_acted := true;
      end if;
    end if;
  end if;

  update reports
     set status = p_status,
         resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() end
   where case p_target_type
           when 'job'     then job_id = p_target_id
           when 'company' then company_id = p_target_id
           else agent_id = p_target_id
         end
     and status in ('open', 'investigating')
     and status <> p_status;
  get diagnostics v_moved = row_count;

  if v_moved = 0 and not v_acted then
    raise exception 'not_found' using hint = 'Nothing open on this target; somebody may have handled it already.';
  end if;

  v_label := coalesce(v_label, case p_target_type
    when 'job'     then (select title_ar from jobs where id = p_target_id)
    when 'company' then (select name_ar from companies where id = p_target_id)
    else (select slug from agent_profiles where id = p_target_id)
  end);

  perform public.admin_audit(
    'report.' || p_status, p_target_type, p_target_id::text, v_label, v_note,
    jsonb_build_object('reports', v_moved, 'took_action', v_acted));

  -- Whether the takedown actually happened, so the caller emails the owner
  -- only about a decision this call made — not one somebody made a moment ago.
  return jsonb_build_object('reports', v_moved, 'took_action', v_acted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal notes
-- ---------------------------------------------------------------------------

create or replace function public.admin_add_note(
  p_target_type text,
  p_target_id   text,
  p_body        text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_id    bigint;
begin
  v_actor := public.admin_begin();

  insert into moderation_notes (target_type, target_id, author_id, author_name, body)
  values (p_target_type, p_target_id, v_actor,
          (select full_name from profiles where id = v_actor), btrim(p_body))
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contact details: revealed one account at a time, with a reason, on record
--
-- No list or search in the console returns a phone number or an email. An
-- operator who needs to reach somebody asks for that one account's details,
-- says why, and the request is audited — so "who looked up this person's
-- number" always has an answer.
-- ---------------------------------------------------------------------------

create or replace function public.admin_reveal_contact(p_user uuid, p_reason text)
returns table (email text, whatsapp_phone text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_reason text;
  v_name   text;
begin
  perform public.admin_begin();
  v_reason := public.admin_reason(p_reason, true, 300);

  select p.full_name into v_name from public.profiles p where p.id = p_user;
  if not found then
    raise exception 'not_found';
  end if;

  perform public.admin_audit('user.contact_revealed', 'user', p_user::text, v_name, v_reason, '{}'::jsonb);

  return query
    select u.email::text, p.whatsapp_phone
      from public.profiles p
      left join auth.users u on u.id = p.id
     where p.id = p_user;
end;
$$;

-- The same rule for a company's private papers. The console mints a
-- five-minute signed URL for a commercial register or a tax card; which admin
-- opened which document, and when, is recorded as the path is handed over.
create or replace function public.admin_open_document(p_document uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc company_documents%rowtype;
begin
  perform public.admin_begin();

  select * into v_doc from company_documents where id = p_document;
  if not found then
    raise exception 'not_found';
  end if;

  perform public.admin_audit('company.document_viewed', 'company', v_doc.company_id::text,
    (select name_ar from companies where id = v_doc.company_id), null,
    jsonb_build_object('document_id', v_doc.id, 'doc_type', v_doc.doc_type));

  return v_doc.storage_path;
end;
$$;

-- Facts about the sign-in, never the credential: whether the address was
-- confirmed, when they last signed in, how. Read-only, so not audited.
create or replace function public.admin_user_facts(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'email_confirmed', u.email_confirmed_at is not null,
           'last_sign_in_at', u.last_sign_in_at,
           'auth_created_at', u.created_at,
           'providers', coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb)
         )
    into v
    from auth.users u
   where u.id = p_user;

  return coalesce(v, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Searching accounts
--
-- By name fragment (trigram-indexed), by exact account id, by exact email and
-- by phone digits — the last two match without ever returning the value, so
-- "is this the person who wrote to support" can be answered without the
-- search results becoming a contact list.
-- ---------------------------------------------------------------------------

create or replace function public.admin_like_pattern(p_query text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

revoke execute on function public.admin_like_pattern(text) from public, anon, authenticated;

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
    select p.id, p.role, p.full_name, p.avatar_url, p.approval_status, p.approval_note,
           p.created_at, c.id, c.name_ar, c.name_en, a.slug, a.restricted_at is not null,
           count(*) over ()
      from profiles p
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
       )
     order by (p.approval_status = 'pending') desc, p.created_at desc, p.id desc
     limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
end;
$$;

-- ---------------------------------------------------------------------------
-- One box that finds anything
-- ---------------------------------------------------------------------------

create or replace function public.admin_search(p_query text)
returns table (kind text, id text, label text, sublabel text, state text)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_q    text := nullif(btrim(p_query), '');
  v_like text;
  v_uuid uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_q is null or length(v_q) < 2 then
    return;
  end if;

  v_like := public.admin_like_pattern(v_q);
  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_q::uuid;
  end if;

  return query
    (select 'user'::text, u.id::text, u.full_name, u.role::text, u.approval_status::text
       from admin_search_users(v_q, null, null, 6, 0) u)
    union all
    (select 'company', c.id::text, c.name_ar, c.name_en,
            case when c.suspended_at is not null then 'suspended' else c.verification_status::text end
       from companies c
      where c.id = v_uuid or c.name_ar ilike v_like or c.name_en ilike v_like or c.slug = lower(v_q)
      order by c.created_at desc
      limit 6)
    union all
    (select 'job', j.id::text, j.title_ar, co.name_ar, j.status::text
       from jobs j join companies co on co.id = j.company_id
      where j.id = v_uuid or j.title_ar ilike v_like or j.title_en ilike v_like or j.slug = lower(v_q)
      order by j.created_at desc
      limit 6)
    union all
    (select 'agent', a.id::text, p.full_name, a.slug,
            case when a.restricted_at is not null then 'restricted' else a.visibility::text end
       from agent_profiles a join profiles p on p.id = a.user_id
      where a.id = v_uuid or a.slug = lower(v_q) or p.full_name ilike v_like
      order by a.created_at desc
      limit 6)
    union all
    (select 'application', ap.id::text, j.title_ar, p.full_name, ap.status::text
       from applications ap
       join jobs j on j.id = ap.job_id
       join profiles p on p.id = ap.candidate_id
      where ap.id = v_uuid
      limit 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- The overview: every number an operator starts the day with, in one trip
--
-- Live means the date, not the label (the cron that relabels is not what
-- makes a listing expired), exactly as the board and the employer console
-- already decide it.
-- ---------------------------------------------------------------------------

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
    'open_targets',  count(distinct coalesce(job_id, company_id, agent_id)) filter (where status in ('open', 'investigating')),
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

-- The rail badges. Restated whole (migration 32) so `reports_open` counts every
-- reported target still open or under investigation, not only listings.
create or replace function public.admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'queue_total',      (select count(*) from jobs where status = 'pending_review'),
    'queue_over_24h',   (select count(*) from jobs
                          where status = 'pending_review' and created_at < now() - interval '24 hours'),
    'reports_open',     (select count(distinct coalesce(job_id, company_id, agent_id))
                           from reports where status in ('open', 'investigating')),
    'companies_pending',(select count(*) from companies where verification_status = 'pending'),
    'accounts_pending', (select count(*) from profiles where approval_status = 'pending'),
    'companies_total',  (select count(*) from companies),
    'live_jobs',        (select count(*) from jobs
                          where status = 'active' and (expires_at is null or expires_at > now())),
    'candidates',       (select count(*) from profiles where role = 'candidate'),
    'employers',        (select count(*) from profiles where role = 'employer'),
    'signups_7d',       (select count(*) from profiles where created_at > now() - interval '7 days'),
    'published_7d',     (select count(*) from jobs where published_at > now() - interval '7 days'),
    'applications_7d',  (select count(*) from applications where created_at > now() - interval '7 days')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Taxonomy
--
-- Locations and developers are rows and can be managed here. Tracks,
-- experience bands and employment types are enums that the job form, the
-- filters, the landing pages and the search all switch on; changing one is a
-- migration and a code change together, not a console action, and the console
-- says so rather than offering a button that would break listings.
-- ---------------------------------------------------------------------------

create or replace function public.admin_taxonomy_usage(p_kind text)
returns table (id int, uses bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_kind = 'district' then
    return query
      select d.id,
             (select count(*) from jobs j where j.district_id = d.id)
           + (select count(*) from companies c where c.district_id = d.id)
           + (select count(*) from agent_profiles a where a.district_ids @> array[d.id])
           + (select count(*) from agent_experience e where e.district_id = d.id)
        from districts d;
  elsif p_kind = 'governorate' then
    return query
      select g.id, (select count(*) from districts d where d.governorate_id = g.id)
        from governorates g;
  elsif p_kind = 'developer' then
    return query
      select v.id,
             (select count(*) from job_developers jd where jd.developer_id = v.id)
           + (select count(*) from agent_developers ad where ad.developer_id = v.id)
        from developers v;
  else
    raise exception 'invalid_action';
  end if;
end;
$$;

create or replace function public.admin_save_taxonomy(
  p_kind           text,
  p_id             int,
  p_name_ar        text,
  p_name_en        text,
  p_slug           text default null,
  p_governorate_id int default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ar   text := btrim(p_name_ar);
  v_en   text := btrim(p_name_en);
  v_slug text := lower(btrim(p_slug));
  v_id   int;
  v_old  text;
begin
  perform public.admin_begin();

  if coalesce(length(v_ar), 0) not between 1 and 80 or coalesce(length(v_en), 0) not between 1 and 80 then
    raise exception 'invalid_name' using hint = 'Both names are required, up to 80 characters.';
  end if;

  if p_id is null then
    if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 60 then
      raise exception 'invalid_slug' using hint = 'Lowercase latin letters, digits and single hyphens.';
    end if;

    if p_kind = 'district' then
      if not exists (select 1 from governorates where id = p_governorate_id) then
        raise exception 'invalid_governorate';
      end if;
      insert into districts (governorate_id, name_ar, name_en, slug)
      values (p_governorate_id, v_ar, v_en, v_slug) returning id into v_id;
    elsif p_kind = 'governorate' then
      insert into governorates (name_ar, name_en, slug) values (v_ar, v_en, v_slug) returning id into v_id;
    elsif p_kind = 'developer' then
      insert into developers (name_ar, name_en, slug) values (v_ar, v_en, v_slug) returning id into v_id;
    else
      raise exception 'invalid_action';
    end if;

    perform public.admin_audit('taxonomy.created', 'taxonomy', p_kind || ':' || v_id, v_ar, null,
      jsonb_build_object('kind', p_kind, 'slug', v_slug));
    return v_id;
  end if;

  -- Renaming. The slug is never touched here, and migration 315's trigger
  -- refuses it by any other path.
  if p_kind = 'district' then
    select name_ar into v_old from districts where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    if p_governorate_id is not null
       and not exists (select 1 from governorates where id = p_governorate_id) then
      raise exception 'invalid_governorate';
    end if;
    update districts
       set name_ar = v_ar, name_en = v_en, governorate_id = coalesce(p_governorate_id, governorate_id)
     where id = p_id;
  elsif p_kind = 'governorate' then
    select name_ar into v_old from governorates where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    update governorates set name_ar = v_ar, name_en = v_en where id = p_id;
  elsif p_kind = 'developer' then
    select name_ar into v_old from developers where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    update developers set name_ar = v_ar, name_en = v_en where id = p_id;
  else
    raise exception 'invalid_action';
  end if;

  perform public.admin_audit('taxonomy.renamed', 'taxonomy', p_kind || ':' || p_id, v_ar, null,
    jsonb_build_object('kind', p_kind, 'from', v_old));
  return p_id;
end;
$$;

create or replace function public.admin_delete_taxonomy(p_kind text, p_id int)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
begin
  perform public.admin_begin();

  -- The in-use check is migration 315's trigger, which every path meets.
  if p_kind = 'district' then
    delete from districts where id = p_id returning name_ar into v_old;
  elsif p_kind = 'governorate' then
    delete from governorates where id = p_id returning name_ar into v_old;
  elsif p_kind = 'developer' then
    delete from developers where id = p_id returning name_ar into v_old;
  else
    raise exception 'invalid_action';
  end if;

  if v_old is null then
    raise exception 'not_found';
  end if;

  perform public.admin_audit('taxonomy.deleted', 'taxonomy', p_kind || ':' || p_id, v_old, null,
    jsonb_build_object('kind', p_kind));
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
--
-- Every function above checks is_admin() itself; the grants are the second
-- lock, so anon cannot even reach the check. Supabase grants EXECUTE to anon
-- explicitly as a function is created, which a revoke from `public` does not
-- touch — hence both.
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_moderate_job(uuid, text, text)                 from public, anon;
revoke execute on function public.admin_set_job_featured(uuid, boolean)                from public, anon;
revoke execute on function public.admin_review_company(uuid, text, text)               from public, anon;
revoke execute on function public.admin_set_company_suspension(uuid, boolean, text)    from public, anon;
revoke execute on function public.admin_set_agent_restriction(uuid, boolean, text)     from public, anon;
revoke execute on function public.set_account_approval(uuid, approval_status, text)    from public, anon;
revoke execute on function public.admin_moderate_reports(text, uuid, text, text, boolean) from public, anon;
revoke execute on function public.admin_add_note(text, text, text)                     from public, anon;
revoke execute on function public.admin_reveal_contact(uuid, text)                     from public, anon;
revoke execute on function public.admin_user_facts(uuid)                               from public, anon;
revoke execute on function public.admin_open_document(uuid)                            from public, anon;
revoke execute on function public.admin_search_users(text, user_role, approval_status, int, int) from public, anon;
revoke execute on function public.admin_search(text)                                   from public, anon;
revoke execute on function public.admin_overview()                                     from public, anon;
revoke execute on function public.admin_summary()                                      from public, anon;
revoke execute on function public.admin_taxonomy_usage(text)                           from public, anon;
revoke execute on function public.admin_save_taxonomy(text, int, text, text, text, int) from public, anon;
revoke execute on function public.admin_delete_taxonomy(text, int)                     from public, anon;

grant execute on function public.admin_moderate_job(uuid, text, text)                 to authenticated;
grant execute on function public.admin_set_job_featured(uuid, boolean)                to authenticated;
grant execute on function public.admin_review_company(uuid, text, text)               to authenticated;
grant execute on function public.admin_set_company_suspension(uuid, boolean, text)    to authenticated;
grant execute on function public.admin_set_agent_restriction(uuid, boolean, text)     to authenticated;
grant execute on function public.set_account_approval(uuid, approval_status, text)    to authenticated, service_role;
grant execute on function public.admin_moderate_reports(text, uuid, text, text, boolean) to authenticated;
grant execute on function public.admin_add_note(text, text, text)                     to authenticated;
grant execute on function public.admin_reveal_contact(uuid, text)                     to authenticated;
grant execute on function public.admin_user_facts(uuid)                               to authenticated;
grant execute on function public.admin_open_document(uuid)                            to authenticated;
grant execute on function public.admin_search_users(text, user_role, approval_status, int, int) to authenticated;
grant execute on function public.admin_search(text)                                   to authenticated;
grant execute on function public.admin_overview()                                     to authenticated;
grant execute on function public.admin_summary()                                      to authenticated;
grant execute on function public.admin_taxonomy_usage(text)                           to authenticated;
grant execute on function public.admin_save_taxonomy(text, int, text, text, text, int) to authenticated;
grant execute on function public.admin_delete_taxonomy(text, int)                     to authenticated;
