-- =============================================================================
-- 349 — A suspended company does not see its applicants
--
-- Suspending a company took its listings down and, since 344, closed the
-- consultant directory and the contact reveals to it, but not the people who
-- had applied to its listings: their names, WhatsApp numbers and CVs stayed
-- open to its members for as long as the suspension lasted. owns_job() is the
-- one door every applicant read goes through (the applications, the
-- applicant's profile and directory card, the pipeline's notes, events and
-- moves, the CV link the website signs after that read), and it now asks that
-- the listing's company is not suspended, as in_good_standing() asks it of
-- the account. Nothing is deleted: the suspension's end opens it again. The
-- daily applicant digest leaves a suspended company out too.
--
-- owns_job() also stood behind a listing's developer tags. Those are the
-- listing's own text, which a suspended company may still save as a draft, so
-- their policy now asks what owns_job() asked before this file. Tested in
-- supabase/tests/doors.test.mjs.
-- =============================================================================

-- rollback: restate owns_job() from migration 308 and pending_applicant_digests() from 324; job_developers_write can stay, as it asks what 308's owns_job() asked
-- safety: rls — job_developers_write keeps the rule it had before this file (the listing's company, in good standing, through owns_company): who may change a listing's developer tags does not change
-- safety: ships-with-code — no company on production is suspended (checked 2026-10-03), so neither order changes anything today. Before this file, the new code already says on the applicant pages that a suspended company's applicants are hidden and reads none; after it without the new code, main's pages show such a company an empty list instead

create or replace function public.owns_job(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.in_good_standing() and exists (
    select 1 from jobs j
      join company_members m on m.company_id = j.company_id
      join companies c on c.id = j.company_id
     where j.id = target and m.user_id = auth.uid()
       and c.suspended_at is null
  );
$$;

create or replace function public.pending_applicant_digests(p_since interval default '24 hours')
returns table (user_id uuid, applicant_count bigint, job_ids uuid[])
language sql
security definer
set search_path = public
as $$
  select p.id,
         count(a.id),
         array_agg(distinct a.job_id)
    from profiles p
    join company_members m on m.user_id = p.id
    join jobs      j on j.company_id = m.company_id
    join companies c on c.id = j.company_id
    join applications a on a.job_id = j.id
   where p.notify_applications = true
     -- A suspended company is not told of applicants it cannot open (349).
     and c.suspended_at is null
     and p.notify_applicant_digest = true
     and a.created_at > greatest(
           now() - interval '7 days',
           coalesce(
             (select coalesce(
                       (select max(r.started_at) from job_runs r
                         where r.job = 'daily-digest'
                           and r.status <> 'skipped'
                           and r.started_at <= last.sent_at
                           and r.started_at >  last.sent_at - interval '1 hour'),
                       last.sent_at)
                from (select max(e.sent_at) as sent_at from email_log e
                       where e.user_id = p.id and e.template = 'applicant_digest') last),
             now() - p_since
           )
         )
     and a.employer_viewed_at is null
   group by p.id
  having count(a.id) > 0;
$$;

-- A listing's developer tags: the listing's company, in good standing, as
-- before this file. Not the applicants' door, so not closed by a suspension.
drop policy if exists job_developers_write on job_developers;
create policy job_developers_write on job_developers
  for all using (exists (select 1 from jobs j where j.id = job_id and public.owns_company(j.company_id)))
  with check (exists (select 1 from jobs j where j.id = job_id and public.owns_company(j.company_id)));
