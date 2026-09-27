-- =============================================================================
-- 306 — How fast is too fast
--
-- Migration 19 put the first two caps in: thirty applications a day, ten
-- reports a day. Both were written as constants inside their triggers, both
-- counted rows by a created_at the client was free to supply, and both counted
-- without a lock — so twenty requests in the same second each saw nineteen.
-- Nothing at all limited how many listings a company could push into the
-- moderation queue, or how many times one person could re-apply, withdraw and
-- re-apply.
--
-- What changes here.
--
-- Every threshold is a row in abuse_limits (migration 304), so the number can
-- move without a deploy when it turns out to be wrong in either direction. The
-- defaults are deliberately loose: an honest person should never meet them,
-- and a script should find them long before it has done any damage.
--
-- Every counter takes a transaction-scoped advisory lock keyed on the account
-- it is counting, so concurrent requests queue and the cap holds.
--
-- Applications get a second, shorter window beside the daily one: a person
-- applying to eight listings in ten minutes is a person; eighty is a loop.
--
-- Listings get a per-company daily cap — smaller for a company nobody has
-- verified — and a rule against the third identical copy: same company, same
-- title after Arabic normalisation, same district, within a month. The wizard
-- already warns about the second copy and deliberately allows it (an employer
-- filling two genuinely separate roles knows better than the form); the third
-- is a pattern, not a decision.
--
-- The in-app bell deduplicates: the same notification to the same person with
-- the same payload inside ten minutes is one notification.
--
-- And rate_limit_hit(), a second reader of the rate_limit_hits counter that
-- migration 68 created, for the things only the application server can see —
-- a CV download, a data export, an account lookup — callable by the service
-- role alone.
-- =============================================================================

-- rollback: drop trigger if exists jobs_15_enforce_post_rate on jobs; drop function if exists public.enforce_job_post_rate, public.rate_limit_hit; restate enforce_application_rate(), enforce_report_rate() and notify() from the migrations that last defined them (19 for the first two); delete from abuse_limits where key in ('applications:user:10min','applications:user:day','reports:user:day','jobs:company:day','jobs:company_unverified:day','jobs:duplicate_copies:30d','cv_download:user:hour','export:user:day','member_lookup:user:day','checkout:company:hour','auth_report:ip:hour');
-- safety: ships-with-code — the triggers refuse only what the old code already showed as
--   an error (the thirty-first application in a day, the eleventh report) plus a short
--   window and a listing cap an honest user does not reach; rate_limit_hit() is called
--   by new code only and reads a table that has existed since migration 68, so either
--   order is safe.

insert into abuse_limits (key, window_seconds, max_hits, note) values
  ('applications:user:10min',        600,   8,   'Applications one candidate may file in ten minutes.'),
  ('applications:user:day',          86400, 30,  'Applications one candidate may file in a day.'),
  ('reports:user:day',               86400, 10,  'Listings one account may report in a day.'),
  ('jobs:company:day',               86400, 20,  'Listings a verified company may create in a day (drafts included).'),
  ('jobs:company_unverified:day',    86400, 5,   'Listings an unverified company may create in a day.'),
  ('jobs:duplicate_copies:30d',      2592000, 2, 'Copies of one title in one district a company may hold in review or live within thirty days.'),
  ('cv_download:user:hour',          3600,  60,  'CVs one account may open in an hour (application CVs and consultant CVs).'),
  ('export:user:day',                86400, 5,   'Personal data exports one account may request in a day.'),
  ('member_lookup:user:day',         86400, 20,  'Colleague-by-email lookups one company admin may make in a day.'),
  ('checkout:company:hour',          3600,  5,   'Checkout sessions one company may open in an hour.'),
  ('auth_report:ip:hour',            3600,  120, 'Sign-in outcome reports one client may send in an hour.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- A counter for the server
-- ---------------------------------------------------------------------------

-- Migration 68 created rate_limit_hits and hit_rate_limit(), a sliding-window
-- counter that answers yes or no. The routes here also need to know how long
-- to tell a client to wait, so this is a second reader of the same table under
-- the same advisory lock — one counter, two questions — rather than a second
-- table. Each call prunes its own bucket, so nothing needs sweeping.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds int, p_max int)
returns table (allowed boolean, remaining int, retry_after_seconds int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window interval := make_interval(secs => greatest(1, p_window_seconds));
  v_count  int;
  v_oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('rate:' || p_key));

  delete from rate_limit_hits
   where bucket = p_key
     and created_at < now() - v_window;

  select count(*), min(created_at) into v_count, v_oldest
    from rate_limit_hits
   where bucket = p_key;

  if v_count >= p_max then
    return query
      select false, 0,
             greatest(1, ceil(extract(epoch from (v_oldest + v_window - now())))::int);
    return;
  end if;

  insert into rate_limit_hits (bucket) values (p_key);
  return query select true, greatest(0, p_max - v_count - 1), 0;
end;
$$;

revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant  execute on function public.rate_limit_hit(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Applications: two windows, one lock
-- ---------------------------------------------------------------------------

create or replace function public.enforce_application_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_short  record;
  v_day    record;
  v_short_n int;
  v_day_n   int;
begin
  -- No bypass for the service role, on purpose: the cap is a property of the
  -- table, as migration 19 made it, and the tests hold it against every caller.
  perform pg_advisory_xact_lock(hashtext('applications:' || new.candidate_id::text));

  select * into v_short from public.limit_for('applications:user:10min', 600, 8);
  select * into v_day   from public.limit_for('applications:user:day', 86400, 30);

  select count(*) into v_short_n from applications
   where candidate_id = new.candidate_id
     and created_at > now() - make_interval(secs => v_short.window_seconds);

  select count(*) into v_day_n from applications
   where candidate_id = new.candidate_id
     and created_at > now() - make_interval(secs => v_day.window_seconds);

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

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports: the same cap, now locked and tunable
-- ---------------------------------------------------------------------------

create or replace function public.enforce_report_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit  record;
  v_recent int;
begin
  if new.reporter_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('reports:' || new.reporter_id::text));

  select * into v_limit from public.limit_for('reports:user:day', 86400, 10);

  select count(*) into v_recent from reports
   where reporter_id = new.reporter_id
     and created_at > now() - make_interval(secs => v_limit.window_seconds);

  if v_recent >= v_limit.max_hits then
    perform public.record_security_event('reports.rate_limited', 'info', null,
      jsonb_build_object('day', v_recent), new.reporter_id);
    raise exception 'report_rate_limit'
      using hint = 'Too many reports from this account today. Try again tomorrow.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Listings: a daily cap per company, and no third copy
-- ---------------------------------------------------------------------------

create or replace function public.enforce_job_post_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_verified  boolean;
  v_limit     record;
  v_copies    record;
  v_today     int;
  v_same      int;
begin
  if public.acting_as_admin() then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('jobs:' || new.company_id::text));

  select verification_status = 'verified' into v_verified
    from companies where id = new.company_id;

  if coalesce(v_verified, false) then
    select * into v_limit from public.limit_for('jobs:company:day', 86400, 20);
  else
    select * into v_limit from public.limit_for('jobs:company_unverified:day', 86400, 5);
  end if;

  select count(*) into v_today from jobs
   where company_id = new.company_id
     and created_at > now() - make_interval(secs => v_limit.window_seconds);

  if v_today >= v_limit.max_hits then
    perform public.record_security_event('jobs.rate_limited', 'warning', null,
      jsonb_build_object('company_id', new.company_id, 'day', v_today), auth.uid());
    raise exception 'job_post_rate_limit'
      using hint = 'This company has created too many listings today. Try again tomorrow.';
  end if;

  -- The third identical copy. Drafts are private and do not count; a retry
  -- carrying the same idempotency key is the same request and is left to the
  -- unique index to answer.
  select * into v_copies from public.limit_for('jobs:duplicate_copies:30d', 2592000, 2);

  select count(*) into v_same from jobs j
   where j.company_id = new.company_id
     and j.district_id = new.district_id
     and j.status in ('pending_review', 'active')
     and j.created_at > now() - make_interval(secs => v_copies.window_seconds)
     -- The same title to a reader: normalised the way search is, and with
     -- runs of whitespace folded, since two spaces is not a second listing.
     and regexp_replace(btrim(public.ar_normalise(j.title_ar)), '\s+', ' ', 'g')
         = regexp_replace(btrim(public.ar_normalise(new.title_ar)), '\s+', ' ', 'g')
     and (new.idempotency_key is null or j.idempotency_key is distinct from new.idempotency_key);

  if new.status <> 'draft' and v_same >= v_copies.max_hits then
    perform public.record_security_event('jobs.duplicate_refused', 'info', null,
      jsonb_build_object('company_id', new.company_id, 'copies', v_same), auth.uid());
    raise exception 'duplicate_listing'
      using hint = 'This company already has this listing in this district. Add seats to it instead.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_job_post_rate() from public, anon, authenticated;

create trigger jobs_15_enforce_post_rate
  before insert on jobs
  for each row execute function public.enforce_job_post_rate();

-- ---------------------------------------------------------------------------
-- The bell does not ring twice for one thing
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
set search_path = public, pg_temp
as $$
  insert into notifications (user_id, kind, payload, href)
  select p_user, p_kind, coalesce(p_payload, '{}'::jsonb), p_href
   where p_user is not null
     and not exists (
       select 1 from notifications n
        where n.user_id = p_user
          and n.kind = p_kind
          and n.payload = coalesce(p_payload, '{}'::jsonb)
          and n.created_at > now() - interval '10 minutes'
     );
$$;
