-- Read-only checks to run on production before the reconciliation of
-- September 2026 (docs/release/2026-09-prod-reconciliation.md).
--
-- The rehearsal (scripts/release/rehearse.mjs) proves the pending files
-- (29 as of main's 328) apply to production's schema. It cannot prove they apply to production's
-- rows: a constraint that is validated as it is added fails on any existing
-- row that breaks it, and rolls its whole file back. These are those
-- constraints, as queries. Nothing here writes.
--
-- BLOCKING: each count must be 0, or the file named fails and the apply
-- stops there. Fix the rows (or ask) before the release window.
--
-- INFORMATIONAL: 307 adds these NOT VALID and then validates what it can,
-- leaving any constraint an old row breaks in place for new writes only and
-- saying so in a notice. A non-zero count is not a failure; it is the list of
-- rows to clean up afterwards.

select * from (
  -- BLOCKING — 069 validates email_suppressions_reason_check as it adds it.
  select 1 as n, 'blocking' as kind, '069 email_suppressions_reason_check' as check_name,
         count(*) as rows_that_fail
    from email_suppressions
   where reason not in ('hard_bounce', 'complaint', 'provider', 'repeated_soft_bounce')
  union all
  -- BLOCKING — 322 re-adds the CV path checks, validated.
  select 2, 'blocking', '322 applications_cv_is_the_applicants', count(*)
    from applications
   where cv_path is not null
     and cv_path !~ ('^' || candidate_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
  union all
  select 3, 'blocking', '322 agent_profiles_cv_is_the_owners', count(*)
    from agent_profiles
   where cv_path is not null
     and cv_path !~ ('^' || user_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
  union all
  -- INFORMATIONAL — 307, added NOT VALID, validated where the rows allow.
  select 4, 'informational', '307 company_documents_path_is_the_companys', count(*)
    from company_documents
   where storage_path !~ ('^' || company_id::text || '/[A-Za-z0-9._-]{1,160}$')
  union all
  select 5, 'informational', '307 companies_website_is_http', count(*)
    from companies
   where website is not null and website !~* '^https?://[^\s]{1,190}$'
  union all
  select 6, 'informational', '307 companies_logo_url_is_https', count(*)
    from companies
   where logo_url is not null
     and not (logo_url ~* '^(https://|http://(localhost|127\.0\.0\.1)[:/])[^\s]+$' and length(logo_url) <= 512)
  union all
  select 7, 'informational', '307 profiles_avatar_url_is_https', count(*)
    from profiles
   where avatar_url is not null
     and not (avatar_url ~* '^(https://|http://(localhost|127\.0\.0\.1)[:/])[^\s]+$' and length(avatar_url) <= 512)
  union all
  select 8, 'informational', '307 agent_profiles tracks/districts/languages bounds', count(*)
    from agent_profiles
   where coalesce(array_length(tracks, 1), 0) > 6
      or coalesce(array_length(district_ids, 1), 0) > 20
      or coalesce(array_length(languages, 1), 0) > 6
  union all
  select 9, 'informational', '307 jobs_rejection_note_length', count(*)
    from jobs where rejection_note is not null and length(rejection_note) > 500
  union all
  select 10, 'informational', '307 company_documents_review_note_length', count(*)
    from company_documents where review_note is not null and length(review_note) > 500
  union all
  -- BLOCKING — 326 makes every report name exactly one target: target_id is
  -- set NOT NULL from the one link a row has, and reports_target_agrees /
  -- reports_one_target are validated as they are added. Its safety line says
  -- production had no reports on 2026-09-27; this says whether that still
  -- holds where it matters — a report with no link, or with two, fails the file.
  select 11, 'blocking', '326 reports with no target, or more than one', count(*)
    from reports
   where num_nonnulls(job_id, company_id, agent_id) <> 1
  union all
  -- INFORMATIONAL — rows 326 backfills (target, snapshot) and 327 moves (a
  -- suspension reason into company_moderation) before their checks are added.
  select 12, 'informational', '326 reports to backfill', count(*) from reports
  union all
  select 13, 'informational', '327 suspension reasons moved to company_moderation', count(*)
    from companies where suspension_reason is not null
) checks
order by n;
