-- =============================================================================
-- 301 — Notifications that cannot repeat, and cannot break what caused them
--
-- The functions half of migration 300. Three changes to how the bell is written,
-- and the events it was missing:
--
-- 1. Every notification carries a deterministic key.
--    notify() and notify_company() take one and insert `on conflict do
--    nothing`. The keys are chosen from what makes two events the same event,
--    and match the email outbox's keys wherever the email has one, so the two
--    channels agree on what "once" means:
--
--      application_received    application_received:{job}:{candidate}
--      application_submitted   application_submitted:{application}
--      application_moved       application_moved:{application}:{status}
--      application_withdrawn   application_withdrawn:{job}:{candidate}
--      job_published/rejected  job_{published|rejected}:{job}:{version}
--      company_verified        company_verified:{company}
--      company_verification_needed
--                              company_verification_needed:{company}:{version}
--      account_approved/rejected
--                              account_{approved|rejected}:{user}:{hour}
--      job_expiring/expired    job_{expiring|expired}:{job}:{expires_at epoch}
--      profile_visibility_changed
--                              profile_visibility:{user}:{visibility}:{cairo day}
--      password_changed        password_changed:{user}:{auth updated_at}
--
--    `version` is the row's optimistic-lock counter from migration 50, bumped
--    in a BEFORE trigger, so an AFTER trigger sees the value the change
--    produced: a listing approved, edited and approved again is two events; a
--    replay of one approval is one.
--
-- 2. A notification failure no longer rolls back the business write.
--    The triggers run inside the transaction that inserted the application or
--    published the listing. An error in one — migration 17 records a publish
--    that failed outright over an enum cast — took the application down with
--    it. Nothing about the bell is part of that transaction's correctness, so
--    each trigger body now catches its own failure, raises a WARNING (which
--    lands in the Postgres log with the event key), and lets the write commit.
--    The policy suite asserts every trigger still writes, which is where a
--    silent bug here gets caught instead of by a candidate whose application
--    vanished.
--
-- 3. The events the email side already had and the bell did not.
--    Job expiry (warned and ended), verification refused, visibility changed
--    and password changed. Expiry cannot be a row trigger — nothing changes on
--    the row when a date passes, and the nightly relabel needs a service-role
--    key production does not have (migration 62) — so it is a sweep that is
--    safe to run from anywhere, because the keys make it idempotent: the cron
--    runs it for everybody, and the employer console runs it for the caller's
--    own company on load.
--
-- Restated whole, every trigger function that writes a notification. `create
-- or replace` replaces the entire body, and this schema has lost a half of one
-- that way three times; each body below carries everything its predecessor
-- did (migration 51 for the three company-scoped ones and the applicant's
-- receipt, 17 for the candidate and account ones, 52 for withdrawal).
-- =============================================================================

create or replace function public.notify(
  p_user    uuid,
  p_kind    notification_kind,
  p_payload jsonb,
  p_href    text,
  p_key     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A notification with no owner is simply nobody's.
  if p_user is null then
    return;
  end if;

  insert into notifications (user_id, kind, payload, href, dedupe_key)
  values (p_user, p_kind, coalesce(p_payload, '{}'::jsonb), p_href, p_key)
  on conflict do nothing;
end;
$$;

-- Service role keeps its grant: the security notice is written from the
-- server, after the evidence check that only the server can make.
revoke execute on function public.notify(uuid, notification_kind, jsonb, text, text)
  from public, anon, authenticated;
-- Said rather than inherited. Supabase's default privileges already give the
-- service role its own grant on every new function, which the revoke above
-- does not touch — but that depends on which role ran the migration, and the
-- server's password notice and the crons must not.
grant execute on function public.notify(uuid, notification_kind, jsonb, text, text) to service_role;

create or replace function public.notify_company(
  p_company uuid,
  p_kind    notification_kind,
  p_payload jsonb,
  p_href    text,
  p_key     text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notifications (user_id, kind, payload, href, dedupe_key)
  select m.user_id, p_kind, coalesce(p_payload, '{}'::jsonb), p_href, p_key
    from company_members m
   where m.company_id = p_company
  on conflict do nothing;
$$;

revoke execute on function public.notify_company(uuid, notification_kind, jsonb, text, text)
  from public, anon, authenticated;

-- rollback: re-run the previous bodies verbatim — notify/notify_company from
--   migrations 17 and 51, on_application_created from 51, on_application_moved
--   and on_approval_changed from 17, on_job_moderated and on_company_verified
--   from 51, on_application_withdrawn from 52, mark_notifications_read from 17
--   — then drop trigger agent_profiles_notify_visibility on agent_profiles and
--   drop the functions this file adds (notify/notify_company with five
--   arguments, on_agent_visibility_changed, emit_job_expiry_notifications,
--   sync_my_job_notifications, open_notification, mark_notifications_read(timestamptz)).
-- safety: ships-with-code — deploy the code first, then run 300–302. The code
--   tolerates the old schema: a missing folded_into column (42703) falls back
--   to the unfiltered feed, a missing open_notification or bounded
--   mark_notifications_read (PGRST202) falls back to the old path, and the
--   sweep, prune and keyed notify() calls fail into a logged warning. The
--   reverse is not safe: the old renderer has no icon for the kinds these
--   files add, and throws on the first one written. The new renderer shows
--   any kind it does not know as a plain notice.

-- ---------------------------------------------------------------------------
-- The four-argument writers, kept as shims
--
-- Every trigger in this file passes a key it chose. Code written against the
-- old four-argument form still exists — migration 201's support answer calls
-- notify(user, kind, payload, href), and other branches may too — and
-- dropping it would turn "support answered you" into a function-not-found
-- error inside the admin's answer. So the old form stays and forwards, with a
-- key derived from everything it was given: the same notification to the
-- same person, word for word, is the same notification. A changed payload is
-- a new one. Not as good as a key chosen from what the event *is* — prefer
-- the five-argument form for anything new — but never worse than the bare
-- insert it replaces.
--
-- No overload ambiguity: the five-argument form has no defaults, so a
-- four-argument call can only mean this one.
-- ---------------------------------------------------------------------------

create or replace function public.notify(
  p_user    uuid,
  p_kind    notification_kind,
  p_payload jsonb,
  p_href    text
)
returns void
language sql
security definer
set search_path = public
as $$
  select public.notify(
    p_user, p_kind, p_payload, p_href,
    p_kind::text || ':' || p_user::text || ':'
      || md5(coalesce(p_payload, '{}'::jsonb)::text || '|' || coalesce(p_href, ''))
  );
$$;

revoke execute on function public.notify(uuid, notification_kind, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.notify(uuid, notification_kind, jsonb, text) to service_role;

create or replace function public.notify_company(
  p_company uuid,
  p_kind    notification_kind,
  p_payload jsonb,
  p_href    text
)
returns void
language sql
security definer
set search_path = public
as $$
  select public.notify_company(
    p_company, p_kind, p_payload, p_href,
    p_kind::text || ':' || p_company::text || ':'
      || md5(coalesce(p_payload, '{}'::jsonb)::text || '|' || coalesce(p_href, ''))
  );
$$;

revoke execute on function public.notify_company(uuid, notification_kind, jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An application arrives → the company, and a receipt for the applicant
-- ---------------------------------------------------------------------------

create or replace function public.on_application_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  begin
    select j.id, j.slug, j.title_ar, j.title_en, j.company_id, c.name_ar, c.name_en
      into v_job
      from jobs j join companies c on c.id = j.company_id
     where j.id = new.job_id;

    -- Every member of the company (migration 51). Keyed on the person and the
    -- listing rather than the row: withdrawing deletes the row and reapplying
    -- makes a new one, and the employer's news is "this person applied to this
    -- listing", which happens once.
    perform public.notify_company(
      v_job.company_id,
      'application_received',
      jsonb_build_object(
        'job_id',    v_job.id,
        'title_ar',  v_job.title_ar,
        'title_en',  v_job.title_en
      ),
      '/employer/jobs/' || v_job.id || '/applicants',
      'application_received:' || v_job.id || ':' || new.candidate_id
    );

    -- The applicant's receipt (migration 21). Per application: a second
    -- application after a withdrawal is a second thing they did.
    perform public.notify(
      new.candidate_id,
      'application_submitted',
      jsonb_build_object(
        'job_id',     v_job.id,
        'title_ar',   v_job.title_ar,
        'title_en',   v_job.title_en,
        'company_ar', v_job.name_ar,
        'company_en', v_job.name_en
      ),
      '/dashboard/applications',
      'application_submitted:' || new.id
    );
  exception when others then
    raise warning 'notification for application % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- An application moves → the candidate
-- ---------------------------------------------------------------------------

create or replace function public.on_application_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- `new` is where an application starts, not a decision anybody made. Moving
  -- one back to it is an employer tidying their board, and "your application
  -- is now: new" is noise at best and a false hope at worst.
  if new.status = 'new' then
    return new;
  end if;

  begin
    select j.title_ar, j.title_en, j.slug into v_job from jobs j where j.id = new.job_id;

    perform public.notify(
      new.candidate_id,
      'application_moved',
      jsonb_build_object(
        'status',   new.status::text,
        'title_ar', v_job.title_ar,
        'title_en', v_job.title_en,
        'slug',     v_job.slug,
        'note',     new.decision_note
      ),
      '/dashboard/applications',
      'application_moved:' || new.id || ':' || new.status::text
    );
  exception when others then
    raise warning 'notification for application % move failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A shortlisted applicant withdraws → the company (migration 52)
-- ---------------------------------------------------------------------------

create or replace function public.on_application_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  if old.status <> 'shortlisted' then
    return old;
  end if;

  begin
    select j.id, j.title_ar, j.title_en, j.company_id
      into v_job
      from jobs j
     where j.id = old.job_id;

    -- The listing went with it: nobody needs telling about their own deletion.
    if v_job.id is null then
      return old;
    end if;

    perform public.notify_company(
      v_job.company_id,
      'application_withdrawn',
      jsonb_build_object(
        'job_id',   v_job.id,
        'title_ar', v_job.title_ar,
        'title_en', v_job.title_en
      ),
      '/employer/jobs/' || v_job.id || '/applicants',
      'application_withdrawn:' || v_job.id || ':' || old.candidate_id
    );
  exception when others then
    raise warning 'notification for withdrawal of % failed: % (%)', old.id, sqlerrm, sqlstate;
  end;

  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderation decides on a listing → the company
-- ---------------------------------------------------------------------------

create or replace function public.on_job_moderated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind notification_kind;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('active', 'rejected') then
    return new;
  end if;

  begin
    v_kind := (case when new.status = 'active' then 'job_published' else 'job_rejected' end)::notification_kind;

    perform public.notify_company(
      new.company_id,
      v_kind,
      jsonb_build_object(
        'job_id',   new.id,
        'title_ar', new.title_ar,
        'title_en', new.title_en,
        'slug',     new.slug,
        'note',     new.rejection_note
      ),
      case when new.status = 'active'
           then '/jobs/' || new.slug
           else '/employer/jobs/' || new.id || '/edit'
      end,
      v_kind::text || ':' || new.id || ':' || new.version
    );
  exception when others then
    raise warning 'notification for listing % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verification decided → the company, either way
--
-- Only `verified` used to reach the bell. A refusal went out by email alone,
-- so an employer who did not read that inbox saw their badge simply not
-- arrive, with the reviewer's note sitting somewhere they would never look.
-- ---------------------------------------------------------------------------

create or replace function public.on_company_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status is not distinct from old.verification_status then
    return new;
  end if;

  begin
    if new.verification_status = 'verified' then
      perform public.notify_company(
        new.id,
        'company_verified',
        jsonb_build_object('name_ar', new.name_ar, 'name_en', new.name_en),
        '/employer/company',
        -- Once ever, like the email: a badge that flaps is not news twice.
        'company_verified:' || new.id
      );
    elsif new.verification_status = 'rejected' then
      perform public.notify_company(
        new.id,
        'company_verification_needed',
        jsonb_build_object('name_ar', new.name_ar, 'name_en', new.name_en),
        '/employer/company',
        -- Per version: each refusal can carry a different reason.
        'company_verification_needed:' || new.id || ':' || new.version
      );
    end if;
  exception when others then
    raise warning 'notification for company % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- An account is approved or suspended → its holder
-- ---------------------------------------------------------------------------

create or replace function public.on_approval_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour text := to_char(date_trunc('hour', now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24');
begin
  if new.approval_status is not distinct from old.approval_status then
    return new;
  end if;

  begin
    if new.approval_status = 'approved' then
      perform public.notify(new.id, 'account_approved', '{}'::jsonb,
                            case when new.role = 'candidate' then '/dashboard' else '/employer' end,
                            'account_approved:' || new.id || ':' || v_hour);
    elsif new.approval_status = 'rejected' then
      perform public.notify(new.id, 'account_rejected',
                            jsonb_build_object('note', new.approval_note), null,
                            'account_rejected:' || new.id || ':' || v_hour);
    end if;
  exception when others then
    raise warning 'notification for account % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A consultant changes who can see them → the consultant
--
-- A privacy setting changing is something the account holder should be able
-- to find a record of, whoever changed it and from wherever. Written from the
-- row rather than from the form's action, so it is true however the row moved.
-- Keyed per value per Cairo day: toggling back and forth all afternoon is one
-- notice per setting, not a feed full of them.
-- ---------------------------------------------------------------------------

create or replace function public.on_agent_visibility_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility is not distinct from old.visibility then
    return new;
  end if;

  begin
    perform public.notify(
      new.user_id,
      'profile_visibility_changed',
      jsonb_build_object('visibility', new.visibility::text),
      '/dashboard/profile',
      'profile_visibility:' || new.user_id || ':' || new.visibility::text || ':'
        || ((now() at time zone 'Africa/Cairo')::date)::text
    );
  exception when others then
    raise warning 'notification for visibility of % failed: % (%)', new.user_id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

revoke execute on function public.on_agent_visibility_changed() from public, anon, authenticated;

drop trigger if exists agent_profiles_notify_visibility on agent_profiles;
create trigger agent_profiles_notify_visibility
  after update of visibility on agent_profiles
  for each row execute function public.on_agent_visibility_changed();

-- Trigger functions are never called directly; the default grant says
-- otherwise, so it is taken back for each one restated here.
revoke execute on function public.on_application_created()  from public, anon, authenticated;
revoke execute on function public.on_application_moved()    from public, anon, authenticated;
revoke execute on function public.on_application_withdrawn() from public, anon, authenticated;
revoke execute on function public.on_job_moderated()        from public, anon, authenticated;
revoke execute on function public.on_company_verified()     from public, anon, authenticated;
revoke execute on function public.on_approval_changed()     from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Listings that are about to end, and listings that have
--
-- One set-based statement per stage. The expiry test is the date, not the
-- label — `active` with an expires_at in the past is ended (migration 62
-- explains why that state exists on production). Bounded behind by a week so
-- the first run after deploy does not announce every listing that ever ended.
--
-- Returns how many notifications it wrote, which a second run on the same day
-- makes zero.
-- ---------------------------------------------------------------------------

create or replace function public.emit_job_expiry_notifications(
  p_company   uuid default null,
  p_warn_days integer default 3
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with due as (
    select j.id, j.company_id, j.slug, j.title_ar, j.title_en, j.expires_at,
           case when j.expires_at <= now() then 'job_expired' else 'job_expiring' end as kind
      from jobs j
     where (p_company is null or j.company_id = p_company)
       and j.expires_at is not null
       and (
             -- about to end
             (j.status = 'active'
              and j.expires_at > now()
              and j.expires_at <= now() + make_interval(days => greatest(p_warn_days, 1)))
          or -- ended, recently
             (j.status in ('active', 'expired')
              and j.expires_at <= now()
              and j.expires_at > now() - interval '7 days')
           )
  ),
  written as (
    insert into notifications (user_id, kind, payload, href, dedupe_key)
    select m.user_id,
           d.kind::notification_kind,
           jsonb_build_object(
             'job_id',     d.id,
             'slug',       d.slug,
             'title_ar',   d.title_ar,
             'title_en',   d.title_en,
             'expires_at', d.expires_at
           ),
           '/employer/jobs',
           d.kind || ':' || d.id || ':' || floor(extract(epoch from d.expires_at))::bigint
      from due d
      join company_members m on m.company_id = d.company_id
    on conflict do nothing
    returning 1
  )
  select count(*)::int into v_count from written;

  return v_count;
end;
$$;

-- Cron only. A caller who could pass any company id could write notices into
-- somebody else's bell — harmless in content, but not theirs to do.
revoke execute on function public.emit_job_expiry_notifications(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.emit_job_expiry_notifications(uuid, integer) to service_role;

-- The same sweep, for the caller's own company and nothing else.
create or replace function public.sync_my_job_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.my_company_id();
begin
  if v_company is null then
    return 0;
  end if;
  return public.emit_job_expiry_notifications(v_company, 3);
end;
$$;

revoke execute on function public.sync_my_job_notifications() from public, anon;
grant  execute on function public.sync_my_job_notifications() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading them
-- ---------------------------------------------------------------------------

-- Mark everything read — up to what the reader has actually seen. Two tabs:
-- the one rendered an hour ago must not clear a notification that arrived
-- since and that it never showed. Null keeps the old meaning.
drop function if exists public.mark_notifications_read();

create or replace function public.mark_notifications_read(p_up_to timestamptz default null)
returns int
language sql
security definer
set search_path = public
as $$
  with updated as (
    update notifications set read_at = now()
     where user_id = (select auth.uid())
       and read_at is null
       and (p_up_to is null or created_at <= p_up_to)
     returning 1
  )
  select count(*)::int from updated;
$$;

revoke execute on function public.mark_notifications_read(timestamptz) from public, anon;
grant  execute on function public.mark_notifications_read(timestamptz) to authenticated, service_role;

-- Open one: mark it read and hand back where it points. Security invoker, so
-- the reader's own RLS decides which row this can touch — somebody else's id
-- updates nothing and returns nothing. Idempotent: opening a read one keeps
-- its first read_at.
create or replace function public.open_notification(p_id uuid)
returns table (kind notification_kind, href text, payload jsonb)
language sql
security invoker
set search_path = public
as $$
  update notifications
     set read_at = coalesce(read_at, now())
   where id = p_id
     and user_id = (select auth.uid())
  returning notifications.kind, notifications.href, notifications.payload;
$$;

revoke execute on function public.open_notification(uuid) from public, anon;
grant  execute on function public.open_notification(uuid) to authenticated, service_role;
