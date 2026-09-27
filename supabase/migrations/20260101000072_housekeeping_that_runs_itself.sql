-- =============================================================================
-- 69 — Housekeeping that runs itself, says what it did, and stops at a limit
--
-- Three things on this platform only ever grow, and one thing that should
-- happen every night has not happened on production for weeks.
--
--   Expiry.  Every scheduled job lives behind a Vercel cron that needs
--            SUPABASE_SERVICE_ROLE_KEY. On 2026-09-27 production held
--            fourteen `active` listings, ten of them past their expires_at:
--            the label had not been corrected since the listings ended. The
--            board has hidden them correctly since migration 46 — every
--            public read asks the date — but the employer dashboards, the
--            audit trail and every "status = 'expired'" query disagreed with
--            it. The expiry is now also scheduled inside the database with
--            pg_cron, where no application secret is involved; the Vercel
--            route stays as the second, independent caller.
--
--   Files.   Replacing a photo, a logo or a CV leaves the old object in its
--            bucket forever, deliberately (the upload components say why:
--            cached pages and sent emails still hold the old URL). A
--            withdrawn application leaves its CV behind with no row pointing
--            at it. Nothing has ever deleted a storage object except account
--            deletion.
--
--   Rows.    notifications, email_log and agent_profile_views have no floor.
--            Migration 63 pruned profile views opportunistically, per
--            consultant, on the next view — and says plainly that a
--            consultant nobody looks at again keeps their rows forever.
--
-- The shape of every job below is the same, and it is the requirement rather
-- than a style:
--
--   bounded      every delete and update takes a limit and walks an index.
--                A backlog drains over several runs; no run holds a lock on
--                a table for longer than one batch.
--   idempotent   running twice in a row does nothing the second time.
--   retry-safe   a run that dies halfway is rolled back and the next run
--                starts from the data, not from a cursor it had to remember.
--   concurrent   `for update skip locked` on every batch, a transaction-level
--                advisory lock on the whole run, and a lease on storage work
--                that crosses the database boundary.
--   observable   every run writes one row to maintenance_runs, including a
--                run that found another already going and stepped aside.
--
-- And one rule over all of it: the periods are data, in retention_policies,
-- not constants in function bodies. Where a period is a legal or business
-- decision nobody has made yet, it is NULL, and NULL means the job does not
-- run — see docs/data-lifecycle.md for the list of decisions outstanding.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Retention periods, as data
-- ---------------------------------------------------------------------------

create table if not exists retention_policies (
  key   text primary key,
  -- Null: keep indefinitely, until somebody decides otherwise.
  days  int check (days is null or days between 1 and 3650),
  basis text not null check (basis in ('product_default', 'already_published', 'operational', 'decision_required')),
  note  text not null
);

alter table retention_policies enable row level security;

drop policy if exists retention_policies_admin on retention_policies;
create policy retention_policies_admin on retention_policies
  for all using (public.is_admin()) with check (public.is_admin());

insert into retention_policies (key, days, basis, note) values
  ('notifications_read',        180, 'product_default',
   'Read in-app notifications. The bell is an inbox, not an archive; decisions it announced are kept in audit_events.'),
  ('notifications_unread',      365, 'product_default',
   'Unread in-app notifications. Longer than read ones, so nothing disappears before somebody could plausibly see it.'),
  ('agent_profile_views',        60, 'already_published',
   'Company-viewed-consultant log. 60 days is the figure migration 63 set and the privacy policy states.'),
  ('maintenance_runs',           90, 'operational',
   'This job''s own run log.'),
  ('storage_gc_done',            30, 'operational',
   'Finished storage-cleanup queue rows.'),
  ('storage_grace_public',        7, 'operational',
   'Days a replaced avatar or logo stays reachable, for cached pages and sent emails that still link it.'),
  ('storage_grace_private',       1, 'operational',
   'Days a released CV or verification document waits before deletion. Signed URLs to it last five minutes.'),
  ('email_log',                 null, 'decision_required',
   'Outbox metadata (template, recipient, status). No body is stored. Keep-forever until a period is chosen.'),
  ('abandoned_signups',         null, 'decision_required',
   'Auth accounts that never confirmed their email, never signed in and never onboarded. Report-only until a period is chosen.')
on conflict (key) do nothing;

comment on table retention_policies is
  'How long each class of data is kept. Null days = kept indefinitely and the '
  'corresponding cleanup does not run. basis = decision_required marks the '
  'periods that need a legal/business owner before they are set.';

create or replace function public.retention_days(p_key text)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select days from retention_policies where key = p_key;
$$;

revoke execute on function public.retention_days(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The run log
-- ---------------------------------------------------------------------------

create table if not exists maintenance_runs (
  id          bigint generated always as identity primary key,
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null check (status in ('running', 'ok', 'partial', 'failed', 'skipped')),
  processed   jsonb not null default '{}'::jsonb,
  error       text
);

create index if not exists maintenance_runs_recent_idx on maintenance_runs (job, started_at desc);

alter table maintenance_runs enable row level security;

drop policy if exists maintenance_runs_admin_read on maintenance_runs;
create policy maintenance_runs_admin_read on maintenance_runs
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Indexes the batches walk
-- ---------------------------------------------------------------------------

-- Retention scans notifications by age across every user; the feed index
-- leads with user_id and cannot serve it.
create index if not exists notifications_created_idx on notifications (created_at);

-- The same for the profile-view log, which is keyed by consultant.
create index if not exists agent_profile_views_day_idx on agent_profile_views (day);

create index if not exists email_log_created_idx on email_log (created_at);

-- "Is this file still referenced" is asked per object by the sweep.
create index if not exists applications_cv_path_idx   on applications (cv_path)   where cv_path is not null;
create index if not exists agent_profiles_cv_path_idx on agent_profiles (cv_path) where cv_path is not null;
create index if not exists company_documents_path_idx on company_documents (storage_path);

-- ---------------------------------------------------------------------------
-- Expiry, bounded
--
-- Replaces the unbounded () version from migration 03: same effect, a limit
-- per call, and skip locked so a moderator editing one listing is never
-- blocked by — or blocks — the sweep. The old signature is dropped rather
-- than overloaded, so rpc('expire_stale_jobs') keeps resolving to exactly one
-- function and the Vercel route needs no change.
-- ---------------------------------------------------------------------------

drop function if exists public.expire_stale_jobs();

create or replace function public.expire_stale_jobs(p_limit int default 500)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 5000);
  n int;
begin
  with due as (
    select id from jobs
     where status = 'active'
       and expires_at is not null
       and expires_at <= now()
     order by expires_at
     limit v_limit
     for update skip locked
  )
  update jobs j
     set status = 'expired'
    from due
   where j.id = due.id;
  get diagnostics n = row_count;

  with lapsed as (
    select id from jobs
     where is_featured
       and featured_until is not null
       and featured_until <= now()
     limit v_limit
     for update skip locked
  )
  update jobs j
     set is_featured = false
    from lapsed
   where j.id = lapsed.id;

  return n;
end;
$$;

revoke execute on function public.expire_stale_jobs(int) from public, anon, authenticated;
grant  execute on function public.expire_stale_jobs(int) to service_role;

-- ---------------------------------------------------------------------------
-- Row retention
-- ---------------------------------------------------------------------------

create or replace function public.prune_notifications(p_limit int default 5000)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_read   int := public.retention_days('notifications_read');
  v_unread int := public.retention_days('notifications_unread');
  n int;
begin
  if v_read is null and v_unread is null then return 0; end if;

  with doomed as (
    select id from notifications
     where (v_read   is not null and read_at is not null and created_at < now() - make_interval(days => v_read))
        or (v_unread is not null and read_at is null     and created_at < now() - make_interval(days => v_unread))
     order by created_at
     limit least(greatest(coalesce(p_limit, 5000), 1), 50000)
     for update skip locked
  )
  delete from notifications n using doomed where n.id = doomed.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.prune_agent_profile_views(p_limit int default 5000)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days int := public.retention_days('agent_profile_views');
  n int;
begin
  if v_days is null then return 0; end if;

  with doomed as (
    select agent_id, company_id, day from agent_profile_views
     where day < (now() at time zone 'Africa/Cairo')::date - v_days
     order by day
     limit least(greatest(coalesce(p_limit, 5000), 1), 50000)
     for update skip locked
  )
  delete from agent_profile_views v using doomed d
   where (v.agent_id, v.company_id, v.day) = (d.agent_id, d.company_id, d.day);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Only when a period has been chosen, and never a row the sweeper could still
-- be working on: `queued` and `failed` within their retry window are left.
create or replace function public.prune_email_log(p_limit int default 5000)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days int := public.retention_days('email_log');
  n int;
begin
  if v_days is null then return 0; end if;

  with doomed as (
    select id from email_log
     where created_at < now() - make_interval(days => greatest(v_days, 7))
       and status not in ('queued')
     order by created_at
     limit least(greatest(coalesce(p_limit, 5000), 1), 50000)
     for update skip locked
  )
  delete from email_log e using doomed where e.id = doomed.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.prune_notifications(int)       from public, anon, authenticated;
revoke execute on function public.prune_agent_profile_views(int) from public, anon, authenticated;
revoke execute on function public.prune_email_log(int)           from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: which files a row still points at
--
-- Avatars and logos are stored as public URLs (they are rendered where no
-- session exists), CVs and documents as bucket paths. One function answers
-- "is anything still pointing here" for all four buckets, and answers TRUE for
-- any bucket it does not know — the sweep must never delete a file because it
-- failed to understand what referenced it.
-- ---------------------------------------------------------------------------

create or replace function public.storage_path_from_url(p_url text, p_bucket text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_url like '%/storage/v1/object/public/' || p_bucket || '/%'
    then nullif(split_part(split_part(p_url, '/storage/v1/object/public/' || p_bucket || '/', 2), '?', 1), '')
  end;
$$;

create index if not exists profiles_avatar_path_idx
  on profiles (public.storage_path_from_url(avatar_url, 'avatars'))
  where avatar_url is not null;

create index if not exists companies_logo_path_idx
  on companies (public.storage_path_from_url(logo_url, 'company-logos'))
  where logo_url is not null;

create or replace function public.storage_object_is_referenced(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_bucket
    when 'cvs' then
         exists (select 1 from applications   where cv_path = p_path)
      or exists (select 1 from agent_profiles where cv_path = p_path)
    when 'avatars' then
         exists (select 1 from profiles
                  where avatar_url is not null
                    and public.storage_path_from_url(avatar_url, 'avatars') = p_path)
    when 'company-logos' then
         exists (select 1 from companies
                  where logo_url is not null
                    and public.storage_path_from_url(logo_url, 'company-logos') = p_path)
    when 'company-documents' then
         exists (select 1 from company_documents where storage_path = p_path)
    else true
  end;
$$;

revoke execute on function public.storage_object_is_referenced(text, text) from public, anon, authenticated;
grant  execute on function public.storage_object_is_referenced(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: the release queue
--
-- A file is never deleted at the moment it stops being referenced. It is
-- queued, with a date before which it may not be touched, and at that date it
-- is checked again — referenced by anything, anywhere, and it is kept.
-- ---------------------------------------------------------------------------

create table if not exists storage_gc_queue (
  bucket        text not null,
  path          text not null,
  reason        text not null check (reason in ('replaced', 'row_deleted', 'orphan_scan')),
  queued_at     timestamptz not null default now(),
  not_before    timestamptz not null,
  -- A lease, because the delete itself happens outside the database (the
  -- Storage API) and a transaction cannot hold a row across that call. A
  -- worker that dies mid-batch lets its lease lapse and the next one retries.
  claimed_until timestamptz,
  attempts      smallint not null default 0 check (attempts >= 0),
  last_error    text,
  outcome       text check (outcome in ('removed', 'kept_referenced', 'missing')),
  done_at       timestamptz,
  primary key (bucket, path),
  constraint storage_gc_queue_done_has_outcome check ((done_at is null) = (outcome is null))
);

create index if not exists storage_gc_queue_due_idx
  on storage_gc_queue (not_before) where done_at is null;
create index if not exists storage_gc_queue_done_idx
  on storage_gc_queue (done_at) where done_at is not null;

alter table storage_gc_queue enable row level security;

drop policy if exists storage_gc_queue_admin_read on storage_gc_queue;
create policy storage_gc_queue_admin_read on storage_gc_queue
  for select using (public.is_admin());

create or replace function public.storage_grace_days(p_bucket text)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.retention_days(
    case when p_bucket in ('avatars', 'company-logos') then 'storage_grace_public'
         else 'storage_grace_private' end), 7);
$$;

revoke execute on function public.storage_grace_days(text) from public, anon, authenticated;

create or replace function public.queue_storage_release(p_bucket text, p_path text, p_reason text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into storage_gc_queue (bucket, path, reason, not_before)
  select p_bucket, p_path, p_reason, now() + make_interval(days => public.storage_grace_days(p_bucket))
   where p_path is not null and btrim(p_path) <> ''
  -- Already waiting: leave it waiting. Previously kept because something still
  -- pointed at it, and now released again: start its grace over.
  on conflict (bucket, path) do update
     set reason = excluded.reason, queued_at = now(), not_before = excluded.not_before,
         claimed_until = null, attempts = 0, last_error = null, outcome = null, done_at = null
   where storage_gc_queue.outcome = 'kept_referenced';
$$;

revoke execute on function public.queue_storage_release(text, text, text) from public, anon, authenticated;

create or replace function public.release_replaced_files()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := case when tg_op = 'DELETE' then 'row_deleted' else 'replaced' end;
begin
  if tg_table_name in ('applications', 'agent_profiles') then
    if tg_op = 'DELETE' or new.cv_path is distinct from old.cv_path then
      perform public.queue_storage_release('cvs', old.cv_path, v_reason);
    end if;
  elsif tg_table_name = 'profiles' then
    if tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url then
      perform public.queue_storage_release('avatars',
        public.storage_path_from_url(old.avatar_url, 'avatars'), v_reason);
    end if;
  elsif tg_table_name = 'companies' then
    if tg_op = 'DELETE' or new.logo_url is distinct from old.logo_url then
      perform public.queue_storage_release('company-logos',
        public.storage_path_from_url(old.logo_url, 'company-logos'), v_reason);
    end if;
  elsif tg_table_name = 'company_documents' then
    if tg_op = 'DELETE' or new.storage_path is distinct from old.storage_path then
      perform public.queue_storage_release('company-documents', old.storage_path, v_reason);
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.release_replaced_files() from public, anon, authenticated;

drop trigger if exists applications_95_release_files on applications;
create trigger applications_95_release_files
  after update of cv_path or delete on applications
  for each row execute function public.release_replaced_files();

drop trigger if exists agent_profiles_95_release_files on agent_profiles;
create trigger agent_profiles_95_release_files
  after update of cv_path or delete on agent_profiles
  for each row execute function public.release_replaced_files();

drop trigger if exists profiles_95_release_files on profiles;
create trigger profiles_95_release_files
  after update of avatar_url or delete on profiles
  for each row execute function public.release_replaced_files();

drop trigger if exists companies_95_release_files on companies;
create trigger companies_95_release_files
  after update of logo_url or delete on companies
  for each row execute function public.release_replaced_files();

drop trigger if exists company_documents_95_release_files on company_documents;
create trigger company_documents_95_release_files
  after update of storage_path or delete on company_documents
  for each row execute function public.release_replaced_files();

-- Files no row ever pointed at: an upload whose save failed, a tab closed
-- between the two steps. A day old before they are even considered, so an
-- upload still on its way to being saved is never mistaken for one.
create or replace function public.queue_storage_orphans(p_limit int default 500)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  insert into storage_gc_queue (bucket, path, reason, not_before)
  select o.bucket_id, o.name, 'orphan_scan',
         now() + make_interval(days => public.storage_grace_days(o.bucket_id))
    from storage.objects o
   where o.bucket_id in ('cvs', 'avatars', 'company-logos', 'company-documents')
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from storage_gc_queue q where q.bucket = o.bucket_id and q.path = o.name)
     and not public.storage_object_is_referenced(o.bucket_id, o.name)
   order by o.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 5000)
  on conflict (bucket, path) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.queue_storage_orphans(int) from public, anon, authenticated;

/*
  Hand a worker the files it may delete now.

  Re-checks every candidate at the moment of claiming. Anything referenced
  again is closed as kept; anything already gone (removed by account
  deletion, or by hand) is closed as missing without an API call. What is
  left is leased for ten minutes and returned. `skip locked` means two
  workers claiming at once receive disjoint sets; the lease means a second
  worker arriving a minute later does too.
*/
create or replace function public.claim_storage_gc(p_limit int default 100)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select q.bucket, q.path
      from storage_gc_queue q
     where q.done_at is null
       and q.not_before <= now()
       and q.attempts < 5
       and (q.claimed_until is null or q.claimed_until < now())
     order by q.not_before
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update skip locked
  ),
  judged as (
    select d.bucket, d.path,
           public.storage_object_is_referenced(d.bucket, d.path) as referenced,
           exists (select 1 from storage.objects o
                    where o.bucket_id = d.bucket and o.name = d.path) as present
      from due d
  ),
  settled as (
    update storage_gc_queue q
       set done_at = now(),
           claimed_until = null,
           outcome = case when j.referenced then 'kept_referenced' else 'missing' end
      from judged j
     where q.bucket = j.bucket and q.path = j.path
       and (j.referenced or not j.present)
    returning q.bucket
  ),
  claimed as (
    update storage_gc_queue q
       set claimed_until = now() + interval '10 minutes',
           attempts = q.attempts + 1
      from judged j
     where q.bucket = j.bucket and q.path = j.path
       and not j.referenced and j.present
    returning q.bucket, q.path
  )
  select c.bucket, c.path from claimed c
  -- Forces `settled` to run: a data-modifying CTE always executes, but naming
  -- it keeps a reader from thinking it is dead code.
  where (select count(*) from settled) >= 0;
end;
$$;

create or replace function public.finish_storage_gc(
  p_bucket  text,
  p_removed text[],
  p_failed  text[] default '{}',
  p_error   text default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update storage_gc_queue
     set done_at = now(), outcome = 'removed', claimed_until = null, last_error = null
   where bucket = p_bucket and path = any (coalesce(p_removed, '{}')) and done_at is null;

  -- Released rather than finished: attempts was spent at claim time, so a
  -- path that keeps failing stops at five and shows up in the integrity report.
  update storage_gc_queue
     set claimed_until = null, last_error = left(coalesce(p_error, 'failed'), 500)
   where bucket = p_bucket and path = any (coalesce(p_failed, '{}')) and done_at is null;
$$;

revoke execute on function public.claim_storage_gc(int) from public, anon, authenticated;
revoke execute on function public.finish_storage_gc(text, text[], text[], text) from public, anon, authenticated;
grant  execute on function public.claim_storage_gc(int) to service_role;
grant  execute on function public.finish_storage_gc(text, text[], text[], text) to service_role;

-- ---------------------------------------------------------------------------
-- Abandoned signups: found, never deleted here
--
-- An account that never confirmed its email, never signed in and never
-- onboarded has no data behind it, which is what makes it the one class of
-- account that could be removed without anybody deciding anything about a
-- person. It is still a person's signup, so this only lists them, and only
-- once a period has been chosen; the Auth admin API does the deleting, in the
-- lifecycle route, so GoTrue's own tables stay consistent.
-- ---------------------------------------------------------------------------

create or replace function public.abandoned_signups(p_limit int default 100)
returns table (user_id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select u.id, u.created_at
    from auth.users u
   where public.retention_days('abandoned_signups') is not null
     and u.created_at < now() - make_interval(days => public.retention_days('abandoned_signups'))
     and u.email_confirmed_at is null
     and u.last_sign_in_at is null
     and not exists (select 1 from profiles p where p.id = u.id)
   order by u.created_at
   limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;

revoke execute on function public.abandoned_signups(int) from public, anon, authenticated;
grant  execute on function public.abandoned_signups(int) to service_role;

-- ---------------------------------------------------------------------------
-- One run
-- ---------------------------------------------------------------------------

create or replace function public.run_lifecycle_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run    bigint;
  v_done   jsonb := '{}'::jsonb;
  v_errors text[] := '{}';
  n        int;
begin
  -- Transaction-scoped and non-blocking: a second worker (pg_cron and the
  -- Vercel route landing in the same minute) records that it stepped aside
  -- and returns, rather than queueing behind the first.
  if not pg_try_advisory_xact_lock(hashtext('brokersconnect.lifecycle_maintenance')) then
    insert into maintenance_runs (job, status, finished_at)
    values ('lifecycle', 'skipped', now());
    return jsonb_build_object('status', 'skipped');
  end if;

  insert into maintenance_runs (job, status) values ('lifecycle', 'running')
  returning id into v_run;

  -- Each step in its own block: one failing step is recorded and the others
  -- still run. Every step is bounded, so a backlog drains over several runs.
  begin
    n := public.expire_stale_jobs(500);
    v_done := v_done || jsonb_build_object('jobs_expired', n);
  exception when others then v_errors := v_errors || ('expire_stale_jobs: ' || sqlerrm);
  end;

  begin
    n := public.prune_notifications(5000);
    v_done := v_done || jsonb_build_object('notifications_pruned', n);
  exception when others then v_errors := v_errors || ('prune_notifications: ' || sqlerrm);
  end;

  begin
    n := public.prune_agent_profile_views(5000);
    v_done := v_done || jsonb_build_object('profile_views_pruned', n);
  exception when others then v_errors := v_errors || ('prune_agent_profile_views: ' || sqlerrm);
  end;

  begin
    n := public.prune_email_log(5000);
    v_done := v_done || jsonb_build_object('email_log_pruned', n);
  exception when others then v_errors := v_errors || ('prune_email_log: ' || sqlerrm);
  end;

  begin
    n := public.queue_storage_orphans(500);
    v_done := v_done || jsonb_build_object('storage_orphans_queued', n);
  exception when others then v_errors := v_errors || ('queue_storage_orphans: ' || sqlerrm);
  end;

  begin
    with doomed as (
      select q.bucket, q.path from storage_gc_queue q
       where q.done_at < now() - make_interval(days => coalesce(public.retention_days('storage_gc_done'), 30))
       limit 5000
       for update skip locked
    )
    delete from storage_gc_queue q using doomed d where q.bucket = d.bucket and q.path = d.path;
    get diagnostics n = row_count;
    v_done := v_done || jsonb_build_object('storage_queue_pruned', n);
  exception when others then v_errors := v_errors || ('prune_storage_gc_queue: ' || sqlerrm);
  end;

  begin
    with doomed as (
      select id from maintenance_runs
       where started_at < now() - make_interval(days => coalesce(public.retention_days('maintenance_runs'), 90))
       limit 5000
       for update skip locked
    )
    delete from maintenance_runs m using doomed where m.id = doomed.id;
    get diagnostics n = row_count;
    v_done := v_done || jsonb_build_object('runs_pruned', n);
  exception when others then v_errors := v_errors || ('prune_maintenance_runs: ' || sqlerrm);
  end;

  update maintenance_runs
     set finished_at = now(),
         status      = case when cardinality(v_errors) = 0 then 'ok' else 'partial' end,
         processed   = v_done,
         error       = nullif(array_to_string(v_errors, '; '), '')
   where id = v_run;

  return v_done || jsonb_build_object(
    'status', case when cardinality(v_errors) = 0 then 'ok' else 'partial' end,
    'run_id', v_run,
    'errors', to_jsonb(v_errors));
end;
$$;

revoke execute on function public.run_lifecycle_maintenance() from public, anon, authenticated;
grant  execute on function public.run_lifecycle_maintenance() to service_role;

-- ---------------------------------------------------------------------------
-- What is wrong, without changing it
--
-- Detection is its own function and never writes. Repair is a separate one,
-- dry-run by default, and only knows how to fix things whose fix is not a
-- judgement about a person: a missing owner membership, a stale label, an
-- unqueued orphan, a missing history row. Everything else is reported for a
-- human to decide.
-- ---------------------------------------------------------------------------

create or replace function public.lifecycle_integrity_report()
returns table (check_name text, severity text, repairable boolean, found bigint, sample jsonb)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.acting_as_admin() then
    raise exception 'forbidden';
  end if;

  return query
  with checks as (
    select 'auth_user_without_profile' as check_name, 'info' as severity, false as repairable,
           array_agg(u.id::text order by u.created_at) as ids
      from auth.users u
     where not exists (select 1 from profiles p where p.id = u.id)
       and u.created_at < now() - interval '1 day'
    union all
    select 'company_owner_not_admin_member', 'error', true, array_agg(c.id::text)
      from companies c
     where not exists (select 1 from company_members m
                        where m.company_id = c.id and m.user_id = c.owner_id and m.role = 'admin')
    union all
    select 'company_member_not_employer', 'warn', false, array_agg(m.company_id || ':' || m.user_id)
      from company_members m join profiles p on p.id = m.user_id
     where p.role <> 'employer'
    union all
    select 'agent_profile_not_candidate', 'warn', false, array_agg(a.id::text)
      from agent_profiles a join profiles p on p.id = a.user_id
     where p.role <> 'candidate'
    union all
    select 'application_by_non_candidate', 'warn', false, array_agg(a.id::text)
      from applications a join profiles p on p.id = a.candidate_id
     where p.role <> 'candidate'
    union all
    select 'application_without_history', 'info', true, array_agg(a.id::text)
      from applications a
     where not exists (select 1 from application_events e where e.application_id = a.id)
    union all
    select 'active_job_past_expiry', 'warn', true, array_agg(j.id::text order by j.expires_at)
      from jobs j
     where j.status = 'active' and j.expires_at <= now()
    union all
    select 'duplicate_live_listing', 'info', false, array_agg(dup.key)
      from (select j.company_id || ':' || j.title_ar as key
              from jobs j
             where j.status = 'active' and j.expires_at > now()
             group by j.company_id, j.title_ar
            having count(*) > 1) dup
    union all
    select 'notification_for_missing_job', 'info', false, array_agg(n.id::text)
      from notifications n
     where n.payload ? 'job_id'
       and not exists (select 1 from jobs j where j.id::text = n.payload ->> 'job_id')
    union all
    select 'email_log_entity_missing', 'info', false, array_agg(e.id::text)
      from email_log e
     where e.entity_type = 'application' and e.entity_id is not null
       and not exists (select 1 from applications a where a.id = e.entity_id)
    union all
    select 'employer_saved_search', 'info', false, array_agg(s.id::text)
      from saved_searches s join profiles p on p.id = s.candidate_id
     where p.role = 'employer'
    union all
    select 'application_cv_missing_file', 'warn', false, array_agg(a.id::text)
      from applications a
     where a.cv_path is not null
       and not exists (select 1 from storage.objects o where o.bucket_id = 'cvs' and o.name = a.cv_path)
    union all
    select 'agent_cv_missing_file', 'warn', false, array_agg(a.id::text)
      from agent_profiles a
     where a.cv_path is not null
       and not exists (select 1 from storage.objects o where o.bucket_id = 'cvs' and o.name = a.cv_path)
    union all
    select 'avatar_missing_file', 'warn', false, array_agg(p.id::text)
      from profiles p
     where public.storage_path_from_url(p.avatar_url, 'avatars') is not null
       and not exists (select 1 from storage.objects o
                        where o.bucket_id = 'avatars'
                          and o.name = public.storage_path_from_url(p.avatar_url, 'avatars'))
    union all
    select 'logo_missing_file', 'warn', false, array_agg(c.id::text)
      from companies c
     where public.storage_path_from_url(c.logo_url, 'company-logos') is not null
       and not exists (select 1 from storage.objects o
                        where o.bucket_id = 'company-logos'
                          and o.name = public.storage_path_from_url(c.logo_url, 'company-logos'))
    union all
    select 'company_document_missing_file', 'error', false, array_agg(d.id::text)
      from company_documents d
     where not exists (select 1 from storage.objects o
                        where o.bucket_id = 'company-documents' and o.name = d.storage_path)
    union all
    select 'unreferenced_file_not_queued', 'info', true, array_agg(o.bucket_id || '/' || o.name)
      from storage.objects o
     where o.bucket_id in ('cvs', 'avatars', 'company-logos', 'company-documents')
       and o.created_at < now() - interval '1 day'
       and not exists (select 1 from storage_gc_queue q where q.bucket = o.bucket_id and q.path = o.name)
       and not public.storage_object_is_referenced(o.bucket_id, o.name)
    union all
    select 'storage_cleanup_exhausted', 'warn', false, array_agg(q.bucket || '/' || q.path)
      from storage_gc_queue q
     where q.done_at is null and q.attempts >= 5
    union all
    select 'account_pending_over_30_days', 'info', false, array_agg(p.id::text)
      from profiles p
     where p.approval_status = 'pending' and p.created_at < now() - interval '30 days'
    union all
    select 'maintenance_not_run_in_26h', 'warn', false,
           case when not exists (select 1 from maintenance_runs r
                                  where r.job = 'lifecycle' and r.status in ('ok', 'partial')
                                    and r.started_at > now() - interval '26 hours')
                then array['lifecycle'] end
  )
  select c.check_name, c.severity, c.repairable,
         coalesce(cardinality(c.ids), 0)::bigint,
         coalesce(to_jsonb(c.ids[1:5]), '[]'::jsonb)
    from checks c
   order by case c.severity when 'error' then 0 when 'warn' then 1 else 2 end, c.check_name;
end;
$$;

revoke execute on function public.lifecycle_integrity_report() from public, anon;
grant  execute on function public.lifecycle_integrity_report() to authenticated, service_role;

create or replace function public.repair_lifecycle_integrity(p_apply boolean default false)
returns table (repair text, affected bigint, applied boolean)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare n bigint;
begin
  if not public.acting_as_admin() then
    raise exception 'forbidden';
  end if;

  -- The owner is always an admin member of their company (migration 22).
  select count(*) into n from companies c
   where not exists (select 1 from company_members m
                      where m.company_id = c.id and m.user_id = c.owner_id and m.role = 'admin');
  if p_apply and n > 0 then
    insert into company_members (company_id, user_id, role)
    select c.id, c.owner_id, 'admin' from companies c
     where not exists (select 1 from company_members m
                        where m.company_id = c.id and m.user_id = c.owner_id)
    on conflict do nothing;
    update company_members m set role = 'admin'
      from companies c
     where c.id = m.company_id and c.owner_id = m.user_id and m.role <> 'admin';
  end if;
  repair := 'restore_owner_admin_membership'; affected := n; applied := p_apply; return next;

  select count(*) into n from jobs where status = 'active' and expires_at <= now();
  if p_apply and n > 0 then
    perform public.expire_stale_jobs(5000);
  end if;
  repair := 'relabel_expired_listings'; affected := n; applied := p_apply; return next;

  -- Migration 42's backfill, for any application that reached the table
  -- without passing its trigger (a restore, a bulk import).
  select count(*) into n from applications a
   where not exists (select 1 from application_events e where e.application_id = a.id);
  if p_apply and n > 0 then
    insert into application_events (application_id, from_status, to_status, actor_id, created_at)
    select a.id, null, a.status, null, a.created_at from applications a
     where not exists (select 1 from application_events e where e.application_id = a.id);
  end if;
  repair := 'backfill_application_history'; affected := n; applied := p_apply; return next;

  -- Queued, not deleted: the grace period and the claim-time re-check still
  -- stand between this and any file going away.
  select count(*) into n from storage.objects o
   where o.bucket_id in ('cvs', 'avatars', 'company-logos', 'company-documents')
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from storage_gc_queue q where q.bucket = o.bucket_id and q.path = o.name)
     and not public.storage_object_is_referenced(o.bucket_id, o.name);
  if p_apply and n > 0 then
    perform public.queue_storage_orphans(5000);
  end if;
  repair := 'queue_unreferenced_files'; affected := n; applied := p_apply; return next;
end;
$$;

revoke execute on function public.repair_lifecycle_integrity(boolean) from public, anon;
grant  execute on function public.repair_lifecycle_integrity(boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Scheduled inside the database, where it needs no application secret
--
-- Conditional, so the same file applies to a Postgres without pg_cron (the
-- test harness) and does nothing there. On Supabase pg_cron is available and
-- this enables it. Hourly: expiry is a label a listing should not carry for a
-- day, and every step is bounded, so an hourly run is cheap when there is
-- nothing to do. cron.schedule with a name replaces a job of that name, so
-- re-applying the migration does not create a second one.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'brokersconnect-lifecycle-maintenance',
      '7 * * * *',
      'select public.run_lifecycle_maintenance()'
    );
  end if;
end;
$$;
