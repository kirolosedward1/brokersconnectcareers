-- =============================================================================
-- 28 — One email a day instead of one per applicant
--
-- The individual "somebody applied" notice is the right default, because it is
-- what a company hiring for one role wants: it arrives while the listing is
-- still on their mind, and it names the person.
--
-- It is the wrong behaviour for the listing that takes twenty applications in
-- an afternoon. Twenty emails is not twenty times as useful — it is one useful
-- email and nineteen reasons to switch notifications off entirely, and the
-- switch they reach for is notify_applications, which also silences the first
-- applicant on their next listing.
--
-- So this is a delivery *mode*, not a second subscription. It is deliberately
-- not a fourth thing to turn off: with the digest on, the individual notice
-- stops and a daily summary takes its place. notify_applications still governs
-- whether either is sent at all, which keeps "tell me about applicants" and
-- "how often" as the two separate questions they actually are.
--
-- Defaults to false: an employer who has said nothing gets the message that is
-- useful on the day it happens.
-- =============================================================================

alter table profiles
  add column notify_applicant_digest boolean not null default false;

comment on column profiles.notify_applicant_digest is
  'Employer: batch new-applicant notices into one daily email instead of one each. Gated by notify_applications.';

-- ---------------------------------------------------------------------------
-- Who is owed a digest, and for what.
--
-- Counted from the applications themselves rather than from a queue: an
-- employer's unseen applicants are already a fact the database can state, and
-- a counter table would be a second copy of it that can drift.
--
-- `employer_viewed_at is null` is the definition of unseen, and it is set by
-- the pipeline move — so an employer who has already opened the applicant and
-- moved them is not told about them again the next morning.
-- ---------------------------------------------------------------------------

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
    join companies c on c.owner_id = p.id
    join jobs      j on j.company_id = c.id
    join applications a on a.job_id = j.id
   where p.notify_applications = true
     and p.notify_applicant_digest = true
     and a.created_at > now() - p_since
     and a.employer_viewed_at is null
   group by p.id
  having count(a.id) > 0;
$$;

revoke all on function public.pending_applicant_digests(interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Candidates who never finished.
--
-- A profile row means they signed up; an agent_profiles row is what makes them
-- findable. Somebody with the first and not the second is invisible to every
-- employer on the platform and almost certainly does not know it.
--
-- Three days old, so it is not a nag sent while they are still filling the
-- form in another tab, and thirty days at the outside, because a reminder
-- about an account somebody abandoned two months ago is just mail. The
-- once-ever guarantee is not here — it is the dedupe key on the outbox, which
-- is the only place that can enforce it across runs.
-- ---------------------------------------------------------------------------

create or replace function public.incomplete_candidate_profiles(p_limit integer default 50)
returns table (user_id uuid)
language sql
security definer
set search_path = public
as $$
  select p.id
    from profiles p
    left join agent_profiles a on a.user_id = p.id
   where p.role = 'candidate'
     and p.created_at < now() - interval '3 days'
     and p.created_at > now() - interval '30 days'
     and (a.id is null or public.profile_completeness(a.id) < 60)
   order by p.created_at
   limit least(greatest(p_limit, 1), 200);
$$;

revoke all on function public.incomplete_candidate_profiles(integer) from public, anon, authenticated;
