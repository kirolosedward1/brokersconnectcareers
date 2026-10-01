-- =============================================================================
-- 338 — Kept as long as the policy says, and no longer
--
-- The privacy policy promises two periods nothing enforced, and four kinds of
-- record had no period at all.
--
--   applications        "twelve months from the date of application, then
--                       deleted" — with the CV attached to each. Deleted now,
--                       by the same path a withdrawal takes (events, notes and
--                       the CV file go with the row), except that nobody is
--                       told: an application reaching its date is not the
--                       candidate withdrawing it.
--   company_documents   "for as long as the company is verified, and for a
--                       year after". A company's papers go a year after it
--                       stopped being verified — companies.verification_ended_at,
--                       stamped from now on — or, for one that never was, a
--                       year after the papers were reviewed. Papers still
--                       waiting for review are never touched.
--   security_events     a year. Salted hashes and ids, kept to see a pattern
--                       of abuse, not to keep a history of everybody.
--   agent_contact_reveals
--                       ninety days. Which company asked for a consultant's
--                       number or CV, and when: the daily limits read a day
--                       of it, a moderator looking into harvesting a few weeks.
--   rate_limit_hits     two days. The longest window counts one.
--
-- The periods are rows in retention_policies (migration 204), changed with one
-- statement. One function applies them, bounded and skip-locked like the rest
-- of the housekeeping, once a day from pg_cron where the database has it and
-- from the nightly /api/cron/lifecycle either way; the two cannot run at once.
-- Files are queued for deletion by the triggers that already queue them, and
-- removed by the storage sweep after their grace period.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: select cron.unschedule('brokersconnect-privacy-retention') (where pg_cron exists); drop function if exists public.run_privacy_retention(int); drop trigger if exists companies_90_verification_ended on companies; drop function if exists public.stamp_verification_ended(); alter table companies drop column verification_ended_at; delete from retention_policies where key in ('applications', 'company_documents', 'security_events', 'agent_contact_reveals', 'rate_limit_hits'); restate on_application_withdrawn() from migration 301
-- safety: ships-with-code — nothing is deleted until run_privacy_retention() runs, which only this file schedules and only the new lifecycle route calls (tolerating its absence); old code calls neither, and the restated withdrawal notice behaves exactly as before outside a purge
-- safety: drop — the deletes are inside run_privacy_retention, each bounded by a where on a period read from retention_policies; this file itself deletes nothing

-- ---------------------------------------------------------------------------
-- When a company stopped being verified
-- ---------------------------------------------------------------------------

alter table companies add column if not exists verification_ended_at timestamptz;

comment on column companies.verification_ended_at is
  'When the company last stopped being verified; null while verified or never verified. Stamped by trigger (migration 338); the verification papers are kept a year from it.';

create or replace function public.stamp_verification_ended()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Derived, never written: whatever a write says about it is replaced.
  if tg_op = 'INSERT' then
    new.verification_ended_at := null;
  elsif new.verification_status = 'verified' then
    new.verification_ended_at := null;
  elsif old.verification_status = 'verified' then
    new.verification_ended_at := now();
  else
    new.verification_ended_at := old.verification_ended_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_verification_ended() from public, anon, authenticated;

drop trigger if exists companies_90_verification_ended on companies;
create trigger companies_90_verification_ended
  before insert or update on companies
  for each row execute function public.stamp_verification_ended();

-- ---------------------------------------------------------------------------
-- The periods
-- ---------------------------------------------------------------------------

insert into retention_policies (key, days, basis, note) values
  ('applications',          365, 'already_published',
   'Applications and the CVs attached to them: twelve months from the date of application, as the privacy policy says (migration 338).'),
  ('company_documents',     365, 'already_published',
   'Verification papers of a company that is not verified: a year after it stopped being verified, or after their review if it never was. Never while verified, never while waiting for review (migration 338).'),
  ('security_events',       365, 'product_default',
   'Security events: salted hashes and ids, kept to see a pattern of abuse (migration 338).'),
  ('agent_contact_reveals',  90, 'product_default',
   'Which company asked for a consultant''s number or CV, and when: the daily limits read a day of it (migration 338).'),
  ('rate_limit_hits',         2, 'operational',
   'Rate-limit counters; the longest window is a day (migration 338).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- A purge is not a withdrawal
-- ---------------------------------------------------------------------------

-- Migration 301's, with one early return: an application deleted because it
-- reached the end of its period tells nobody anything.
create or replace function public.on_application_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  if coalesce(current_setting('app.retention_purge', true), 'off') = 'on' then
    return old;
  end if;

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

revoke execute on function public.on_application_withdrawn() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Applying them
-- ---------------------------------------------------------------------------

create or replace function public.run_privacy_retention(p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_done   jsonb := '{}'::jsonb;
  v_errors text[] := '{}';
  v_days   int;
  n        int;
begin
  -- pg_cron and the nightly route may both call this; one of them waits a day.
  if not pg_try_advisory_xact_lock(hashtext('brokersconnect-privacy-retention')) then
    return jsonb_build_object('skipped', true);
  end if;

  -- Applications, a year after they were sent. Every period here has a floor,
  -- so a mistyped `1` cannot empty a table.
  v_days := public.retention_days('applications');
  if v_days is not null then
    begin
      perform set_config('app.retention_purge', 'on', true);
      with doomed as (
        select id from applications
         where created_at < now() - make_interval(days => greatest(v_days, 30))
         order by created_at
         limit v_limit
         for update skip locked
      )
      delete from applications a using doomed where a.id = doomed.id;
      get diagnostics n = row_count;
      perform set_config('app.retention_purge', 'off', true);
      v_done := v_done || jsonb_build_object('applications', n);
    exception when others then
      v_errors := v_errors || ('applications: ' || sqlerrm);
    end;
  end if;

  -- Verification papers of a company that is not verified.
  v_days := public.retention_days('company_documents');
  if v_days is not null then
    begin
      with doomed as (
        select d.id
          from company_documents d
          join companies c on c.id = d.company_id
         where c.verification_status <> 'verified'
           and d.status <> 'pending'
           and greatest(coalesce(d.reviewed_at, d.created_at),
                        coalesce(c.verification_ended_at, '-infinity'::timestamptz))
               < now() - make_interval(days => greatest(v_days, 30))
         order by d.created_at
         limit v_limit
         for update of d skip locked
      )
      delete from company_documents x using doomed where x.id = doomed.id;
      get diagnostics n = row_count;
      v_done := v_done || jsonb_build_object('company_documents', n);
    exception when others then
      v_errors := v_errors || ('company_documents: ' || sqlerrm);
    end;
  end if;

  v_days := public.retention_days('security_events');
  if v_days is not null then
    begin
      with doomed as (
        select id from security_events
         where created_at < now() - make_interval(days => greatest(v_days, 30))
         order by created_at
         limit v_limit * 10
         for update skip locked
      )
      delete from security_events e using doomed where e.id = doomed.id;
      get diagnostics n = row_count;
      v_done := v_done || jsonb_build_object('security_events', n);
    exception when others then
      v_errors := v_errors || ('security_events: ' || sqlerrm);
    end;
  end if;

  v_days := public.retention_days('agent_contact_reveals');
  if v_days is not null then
    begin
      with doomed as (
        select id from agent_contact_reveals
         where created_at < now() - make_interval(days => greatest(v_days, 2))
         order by created_at
         limit v_limit * 10
         for update skip locked
      )
      delete from agent_contact_reveals r using doomed where r.id = doomed.id;
      get diagnostics n = row_count;
      v_done := v_done || jsonb_build_object('agent_contact_reveals', n);
    exception when others then
      v_errors := v_errors || ('agent_contact_reveals: ' || sqlerrm);
    end;
  end if;

  v_days := public.retention_days('rate_limit_hits');
  if v_days is not null then
    begin
      delete from rate_limit_hits
       where ctid in (
         select ctid from rate_limit_hits
          where created_at < now() - make_interval(days => greatest(v_days, 2))
          limit v_limit * 20
       );
      get diagnostics n = row_count;
      v_done := v_done || jsonb_build_object('rate_limit_hits', n);
    exception when others then
      v_errors := v_errors || ('rate_limit_hits: ' || sqlerrm);
    end;
  end if;

  return v_done || jsonb_build_object('errors', to_jsonb(v_errors));
end;
$$;

revoke all on function public.run_privacy_retention(int) from public, anon, authenticated;
grant execute on function public.run_privacy_retention(int) to service_role;

-- Daily inside the database where pg_cron is there (migration 204's pattern:
-- a named job, replaced rather than doubled by a second apply); the nightly
-- Vercel route calls it too.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'brokersconnect-privacy-retention',
      '37 3 * * *',
      'select public.run_privacy_retention()'
    );
  end if;
end;
$$;
