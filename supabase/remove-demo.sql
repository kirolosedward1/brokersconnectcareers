-- =============================================================================
-- The seeded demo data's rows, removed (scripts/remove-demo.mjs).
--
-- supabase/seed-demo.sql makes accounts at @demo.test and the companies,
-- listings and applications around them: data for a local or staging
-- database, which has no place beside real people's (docs/app-store.md,
-- "Before the first submission"). Its users cannot simply be deleted in the
-- dashboard: a profile that owns a company is never deleted from under it
-- (companies_owner_id_fkey restricts), so the employers' deletions fail. This
-- file takes away what stands in the way, in one transaction, and the script
-- then deletes the users through the Auth admin API, which takes their
-- profiles and everything that is only theirs.
--
-- Removed here: every company a demo account owns, its listings, and every
-- application to those listings — including any from a real person, who
-- applied to a listing that was never real. Refused: a demo company with a
-- member who is not a demo account (their own company access would go with
-- it); that needs a person to decide.
--
-- With demo.dry_run = 'on' it only counts, changing nothing; the counts come
-- back as a notice either way.
-- =============================================================================

do $$
declare
  v_companies uuid[];
  v_outsiders int;
  v_jobs      int;
  v_from_demo int;
  v_from_real int;
  v_accounts  int;
  v_dry       boolean := coalesce(current_setting('demo.dry_run', true), 'off') = 'on';
begin
  select coalesce(array_agg(c.id), '{}')
    into v_companies
    from companies c
    join auth.users u on u.id = c.owner_id
   where lower(u.email) like '%@demo.test';

  select count(*) into v_outsiders
    from company_members m
    join auth.users u on u.id = m.user_id
   where m.company_id = any (v_companies)
     and lower(u.email) not like '%@demo.test';

  select count(*) into v_jobs from jobs where company_id = any (v_companies);

  select count(*) filter (where lower(u.email) like '%@demo.test'),
         count(*) filter (where lower(u.email) not like '%@demo.test')
    into v_from_demo, v_from_real
    from applications a
    join jobs j on j.id = a.job_id
    join auth.users u on u.id = a.candidate_id
   where j.company_id = any (v_companies);

  select count(*) into v_accounts from auth.users where lower(email) like '%@demo.test';

  raise notice 'demo: % accounts, % companies, % listings, % applications from demo accounts, % from others, % members who are not demo accounts',
    v_accounts, cardinality(v_companies), v_jobs, v_from_demo, v_from_real, v_outsiders;

  if v_dry then
    return;
  end if;

  if v_outsiders > 0 then
    raise exception 'a demo company has % member(s) who are not demo accounts: decide about them first', v_outsiders;
  end if;

  -- The applications first: a listing is never deleted from under them
  -- (applications_job_id_fkey restricts).
  delete from applications
   where job_id in (select id from jobs where company_id = any (v_companies));
  delete from companies where id = any (v_companies);
end
$$;
