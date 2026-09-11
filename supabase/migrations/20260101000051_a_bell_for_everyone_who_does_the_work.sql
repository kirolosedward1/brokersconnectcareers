-- =============================================================================
-- 51 — Notifications addressed to the founder, for work the team does
--
-- Migration 22 made a company a team: company_members, admins and recruiters,
-- and row-level security moved onto membership so any member may read the
-- company's applicants, post a listing and move the pipeline. Migration 41
-- fixed the three functions still resolving a company by ownership. The
-- notification triggers were not in either pass, and all three still address
-- companies.owner_id:
--
--   on_application_created   an applicant arrives and only the founder's bell
--                            rings — the recruiter whose listing it is, and
--                            who will actually answer it, is told nothing.
--   on_job_moderated         a listing is approved or rejected and the person
--                            who wrote it does not hear.
--   on_company_verified      the company is verified and one person knows.
--
-- And if the owner's account is suspended, or they simply stop logging in,
-- nobody hears anything at all — the company keeps receiving applications and
-- the bell rings in an inbox no one opens.
--
-- Every member, then. A notification is per-person by construction: each row
-- carries a user_id and each person has their own bell and their own read
-- state. Ten members means ten rows, which is the point rather than the cost.
--
-- Production has no recruiter-role members yet — every company_members row is
-- an admin, and each company has exactly one — so this changes nothing that is
-- happening today and everything that happens the first time somebody invites
-- a colleague.
-- =============================================================================

-- One place that answers "who at this company should hear about this", so the
-- three triggers below cannot drift apart again.
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
  insert into notifications (user_id, kind, payload, href)
  select m.user_id, p_kind, coalesce(p_payload, '{}'::jsonb), p_href
    from company_members m
   where m.company_id = p_company;
$$;

revoke execute on function public.notify_company(uuid, notification_kind, jsonb, text)
  from public, anon, authenticated;

-- Restated whole, carrying migration 21's half as well as migration 17's.
-- The first draft of this file rewrote only the employer's notice and dropped
-- the applicant's receipt with it — `create or replace` replaces the whole
-- body, and the body had grown since. The policy suite caught it, which is the
-- third time this trap has been sprung in this schema and the reason both
-- halves are commented here rather than assumed.
create or replace function public.on_application_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  select j.id, j.slug, j.title_ar, j.title_en, j.company_id, c.name_ar, c.name_en
    into v_job
    from jobs j join companies c on c.id = j.company_id
   where j.id = new.job_id;

  -- The company — every member of it now, rather than whoever signed up.
  perform public.notify_company(
    v_job.company_id,
    'application_received',
    jsonb_build_object(
      'job_id',    v_job.id,
      'title_ar',  v_job.title_ar,
      'title_en',  v_job.title_en
    ),
    '/employer/jobs/' || v_job.id || '/applicants'
  );

  -- And the applicant, from migration 21. The company travels in the payload
  -- because "your application to X at Y" is the sentence somebody wants back,
  -- and the feed is bilingual — so it stores the data and lets the reader's
  -- locale pick the words.
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
    '/dashboard/applications'
  );

  return new;
end;
$$;

create or replace function public.on_job_moderated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('active', 'rejected') then
    return new;
  end if;

  perform public.notify_company(
    new.company_id,
    -- Cast, because a CASE over two string literals is typed `text`, and the
    -- overload it then looks for does not exist. Publishing a listing failed
    -- outright until this was pinned to the enum.
    (case when new.status = 'active' then 'job_published' else 'job_rejected' end)::notification_kind,
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
    end
  );

  return new;
end;
$$;

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
  if new.verification_status <> 'verified' then
    return new;
  end if;

  perform public.notify_company(
    new.id,
    'company_verified',
    jsonb_build_object('name_ar', new.name_ar, 'name_en', new.name_en),
    '/employer/company'
  );

  return new;
end;
$$;

-- The morning digest, by membership for the same reason. It joined
-- `companies c on c.owner_id = p.id`, so a recruiter never received one and a
-- company whose owner had switched the digest off received none at all.
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
-- A kind for the one event the employer was never told about
--
-- Added here and used in migration 52, because Postgres will not let a
-- transaction use an enum value the same transaction added and db-push wraps
-- each migration in its own. Migration 21 split a pair for the same reason.
-- ---------------------------------------------------------------------------

alter type notification_kind add value if not exists 'application_withdrawn';
