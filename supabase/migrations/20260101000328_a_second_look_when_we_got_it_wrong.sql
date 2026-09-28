-- =============================================================================
-- 328 — A second look when we got it wrong
--
-- Every lever in the console can be pulled on the wrong thing. A listing taken
-- down on a competitor's report, a company suspended for another company's
-- phone number, a consultant restricted because a real name looked like an
-- impersonation — and the person on the other end had no way to say so except
-- to find an email address and hope.
--
-- An appeal is one message about one decision, and one answer. Not a ticket
-- system: no thread, no assignment, no statuses beyond open and decided.
--
--   Who      the account the decision is about — for a listing or a company,
--            any member of that company; for an account or a consultant
--            profile, its own holder.
--   When     while the decision still stands: a listing rejected or taken
--            down, a company suspended, an account suspended or put on hold
--            by a moderator, a consultant profile restricted.
--   How often one open appeal per decision; after an answer, another only a
--            week later; three per decision at most; five a day per person.
--            A listing whose company is suspended is appealed through the
--            company — restoring the listing could not succeed anyway.
--   Answer   uphold (a reason is required — the person is owed one) or
--            overturn, which reverses the decision through the same lever a
--            moderator would use by hand: the post cap, the credit and the
--            suspension still apply, and the reversal is audited on its own
--            as well as the decision on the appeal.
--
-- Two moderators answering the same appeal: the row is locked and must still
-- be open, so the second is told it has already been decided.
-- =============================================================================

-- rollback: by hand, first of 326–328 — the statements are listed at the end of this file
-- safety: ships-with-code — apply after the deploy that carries this branch's src/ changes. The new code works without it (the console says the migration is missing, the report and appeal forms refuse cleanly), but main's bell shows the notification kind this writes (appeal_decided) only as its generic line, so the person would not be told what happened until the code arrives.

create table if not exists moderation_appeals (
  id                uuid primary key default gen_random_uuid(),
  subject_type      text not null check (subject_type in ('job', 'company', 'account', 'agent')),
  subject_id        uuid not null,
  appellant_id      uuid references profiles (id) on delete set null,
  message           text not null check (length(btrim(message)) between 10 and 1000),
  -- The decision as it stood when appealed, so the answer is read against it.
  decision_snapshot jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(decision_snapshot) = 'object' and pg_column_size(decision_snapshot) <= 4096),
  status            text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  decided_by        uuid references profiles (id) on delete set null,
  decided_at        timestamptz,
  decision_note     text check (length(decision_note) <= 1000),
  created_at        timestamptz not null default now(),
  constraint moderation_appeals_decided_is_dated check ((status = 'open') = (decided_at is null))
);

create unique index if not exists moderation_appeals_one_open
  on moderation_appeals (subject_type, subject_id) where status = 'open';
create index if not exists moderation_appeals_subject_idx
  on moderation_appeals (subject_type, subject_id, created_at desc);
create index if not exists moderation_appeals_appellant_idx
  on moderation_appeals (appellant_id, created_at desc);
create index if not exists moderation_appeals_open_idx
  on moderation_appeals (created_at) where status = 'open';
create index if not exists moderation_appeals_decided_by_idx
  on moderation_appeals (decided_by);

alter table moderation_appeals enable row level security;

-- The appellant, the company an appeal is about (so a colleague sees one is
-- already open), and admins. Nobody writes it except the two functions below.
drop policy if exists moderation_appeals_read on moderation_appeals;
create policy moderation_appeals_read on moderation_appeals
  for select using (
    appellant_id = (select auth.uid())
    or (select public.is_admin())
    or (subject_type = 'company' and public.owns_company(subject_id))
    or (subject_type = 'job' and public.owns_job(subject_id))
  );

revoke all on moderation_appeals from anon;
revoke insert, update, delete, truncate on moderation_appeals from authenticated;

-- ---------------------------------------------------------------------------
-- Who may appeal what
--
-- One function answers it, for the form that offers an appeal and for the
-- submission alike, so the button and the rule cannot disagree. Returns the
-- decision as it stands (what the appeal will be read against), or null when
-- this account has nothing here it can appeal.
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
                              'label_ar', j.title_ar, 'label_en', j.title_en, 'company_id', j.company_id)
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

revoke execute on function public.appeal_decision_snapshot(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------------

create or replace function public.submit_appeal(
  p_subject_type text,
  p_subject_id   uuid,
  p_message      text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_message  text := btrim(p_message);
  v_snapshot jsonb;
  v_count    int;
  v_last     timestamptz;
  v_id       uuid;
begin
  if v_user is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_subject_type not in ('job', 'company', 'account', 'agent') then
    raise exception 'invalid_action';
  end if;
  if v_message is null or length(v_message) < 10 then
    raise exception 'appeal_message_required' using hint = 'Say in a sentence or two why the decision was wrong.';
  end if;
  if length(v_message) > 1000 then
    raise exception 'appeal_message_too_long';
  end if;

  -- Two colleagues appealing the same decision at once meet here in turn.
  perform pg_advisory_xact_lock(hashtextextended('appeal:' || p_subject_type || ':' || p_subject_id::text, 0));

  -- A listing of a suspended company could not be restored anyway; the
  -- company's suspension is the decision to appeal.
  if p_subject_type = 'job'
     and exists (select 1 from jobs j join companies c on c.id = j.company_id
                  where j.id = p_subject_id and c.suspended_at is not null
                    and exists (select 1 from company_members m
                                 where m.company_id = j.company_id and m.user_id = v_user)) then
    raise exception 'company_suspended' using hint = 'Appeal the company''s suspension instead.';
  end if;

  v_snapshot := public.appeal_decision_snapshot(v_user, p_subject_type, p_subject_id);
  if v_snapshot is null then
    raise exception 'not_appealable'
      using hint = 'There is no standing decision here that this account can appeal.';
  end if;

  if exists (select 1 from moderation_appeals
              where subject_type = p_subject_type and subject_id = p_subject_id and status = 'open') then
    raise exception 'appeal_open' using hint = 'An appeal about this is already waiting for an answer.';
  end if;

  select count(*), max(decided_at) into v_count, v_last
    from moderation_appeals
   where subject_type = p_subject_type and subject_id = p_subject_id;
  if v_count >= 3 then
    raise exception 'appeal_limit' using hint = 'This decision has been reviewed three times.';
  end if;
  if v_last > now() - interval '7 days' then
    raise exception 'appeal_too_soon' using hint = 'An appeal about this was answered in the last week.';
  end if;

  if (select count(*) from moderation_appeals
       where appellant_id = v_user and created_at > now() - interval '1 day') >= 5 then
    raise exception 'appeal_rate_limit';
  end if;

  insert into moderation_appeals (subject_type, subject_id, appellant_id, message, decision_snapshot)
  values (p_subject_type, p_subject_id, v_user, v_message, v_snapshot)
  returning id into v_id;

  return v_id;
end;
$$;

-- What the page offers: whether this account can appeal the decision, the
-- appeal already waiting if there is one, and the last answer. Never another
-- person's appeal — the answer is about the caller's own standing.
create or replace function public.my_appeal_state(p_subject_type text, p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_open jsonb;
  v_last jsonb;
  v_count int;
begin
  if v_user is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object('id', a.id, 'created_at', a.created_at)
    into v_open
    from moderation_appeals a
   where a.subject_type = p_subject_type and a.subject_id = p_subject_id and a.status = 'open';

  select jsonb_build_object('status', a.status, 'decided_at', a.decided_at, 'note', a.decision_note),
         count(*) over ()
    into v_last, v_count
    from moderation_appeals a
   where a.subject_type = p_subject_type and a.subject_id = p_subject_id and a.status <> 'open'
   order by a.decided_at desc
   limit 1;

  return jsonb_build_object(
    'appealable', public.appeal_decision_snapshot(v_user, p_subject_type, p_subject_id) is not null
                  and v_open is null
                  and coalesce(v_count, 0) < 3
                  and coalesce((v_last ->> 'decided_at')::timestamptz, '-infinity') <= now() - interval '7 days',
    'open', v_open,
    'last', v_last);
end;
$$;

revoke execute on function public.my_appeal_state(text, uuid) from public, anon;
grant  execute on function public.my_appeal_state(text, uuid) to authenticated;

revoke execute on function public.submit_appeal(text, uuid, text) from public, anon;
grant  execute on function public.submit_appeal(text, uuid, text) to authenticated;

-- The reason a moderator gave for the decision on this account, to its holder
-- while the decision stands, and to nobody else. profile_private stays
-- admin-only (305): this reads one column of the caller's own row, and only
-- while the account is suspended or on hold. A suspension's reason has already
-- been sent to them (on_approval_changed puts it in the notification); a hold
-- is announced without it, and the console tells the moderator the person is
-- told the reason — this is where they read it, beside the way to appeal it.
create or replace function public.my_account_note()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pp.approval_note
    from profile_private pp
    join profiles p on p.id = pp.user_id
   where pp.user_id = (select auth.uid())
     and p.approval_status <> 'approved';
$$;

revoke execute on function public.my_account_note() from public, anon;
grant  execute on function public.my_account_note() to authenticated;

-- ---------------------------------------------------------------------------
-- Answering
-- ---------------------------------------------------------------------------

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
    -- Reversed only if the decision still stands; if somebody already lifted
    -- it by hand, the appeal is answered without doing it twice.
    if v_appeal.subject_type = 'job' then
      if exists (select 1 from jobs where id = v_appeal.subject_id and status = 'rejected') then
        perform public.admin_moderate_job(v_appeal.subject_id, 'restore', v_note);
        v_acted := true;
      end if;
    elsif v_appeal.subject_type = 'company' then
      if exists (select 1 from companies where id = v_appeal.subject_id and suspended_at is not null) then
        perform public.admin_set_company_suspension(v_appeal.subject_id, false, coalesce(v_note, v_restore));
        v_acted := true;
      end if;
    elsif v_appeal.subject_type = 'account' then
      if exists (select 1 from profiles where id = v_appeal.subject_id and approval_status <> 'approved') then
        perform public.set_account_approval(v_appeal.subject_id, 'approved', v_note);
        v_acted := true;
      end if;
    else
      if exists (select 1 from agent_profiles where id = v_appeal.subject_id and restricted_at is not null) then
        perform public.admin_set_agent_restriction(v_appeal.subject_id, false, coalesce(v_note, v_restore));
        v_acted := true;
      end if;
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
    jsonb_build_object('appeal_id', v_appeal.id, 'reversed', v_acted));

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

revoke execute on function public.admin_decide_appeal(uuid, boolean, text) from public, anon;
grant  execute on function public.admin_decide_appeal(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The rail badges, restated whole (migration 318) with two changes:
-- reports_open counts every reported target by its record, so reports about a
-- deleted listing still count; and appeals_open is new.
-- ---------------------------------------------------------------------------

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
    'reports_open',     (select count(distinct (target_type, target_id))
                           from reports where status in ('open', 'investigating')),
    'appeals_open',     (select count(*) from moderation_appeals where status = 'open'),
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

revoke execute on function public.admin_summary() from public, anon;
grant  execute on function public.admin_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- Rollback, by hand, before 327 and 326:
--
--   drop function if exists public.admin_decide_appeal(uuid, boolean, text);
--   drop function if exists public.my_account_note();
--   drop function if exists public.my_appeal_state(text, uuid);
--   drop function if exists public.submit_appeal(text, uuid, text);
--   drop function if exists public.appeal_decision_snapshot(uuid, text, uuid);
--   drop table if exists moderation_appeals;
--   -- restate admin_summary() exactly as migration 318 wrote it
-- ---------------------------------------------------------------------------
