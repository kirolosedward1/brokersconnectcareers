-- =============================================================================
-- 05 — Privilege guards
--
-- Things RLS cannot express, because a WITH CHECK sees only the row as it will
-- be, never as it was. These triggers compare OLD to NEW and reject escalation.
-- The service role and admins pass straight through.
-- =============================================================================

create or replace function public.acting_as_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce(
      -- PostgREST leaves request.jwt.claims as an EMPTY STRING on requests that
      -- carry no JWT, and ''::jsonb raises 22P02. Without the nullif, every
      -- guarded UPDATE on an unauthenticated path fails with a cast error
      -- instead of a policy decision. NULL here means no claims at all — a
      -- direct database connection (migrations, seeding, the service role),
      -- which is trusted by definition.
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      'service_role'
    ) = 'service_role'
    or public.is_admin();
$$;

-- ---------------------------------------------------------------------------
-- Companies: verification and credits are granted, never claimed.
-- ---------------------------------------------------------------------------

create or replace function public.guard_company_update()
returns trigger
language plpgsql
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if new.verification_status is distinct from old.verification_status then
    raise exception 'verification_status is set by review, not by the owner';
  end if;
  if new.post_credits is distinct from old.post_credits then
    raise exception 'post_credits is set by billing, not by the owner';
  end if;
  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set by review, not by the owner';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'company ownership cannot be transferred';
  end if;

  return new;
end;
$$;

create trigger companies_guard_update
  before update on companies
  for each row execute function public.guard_company_update();

-- ---------------------------------------------------------------------------
-- Jobs: an employer submits for review. Only a reviewer publishes.
--
-- Allowed owner transitions:
--   draft          -> draft | pending_review
--   pending_review -> draft | pending_review
--   active         -> closed
--   expired        -> pending_review | closed
--   closed         -> pending_review
--   rejected       -> draft | pending_review
-- ---------------------------------------------------------------------------

create or replace function public.guard_job_update()
returns trigger
language plpgsql
as $$
declare
  ok boolean;
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if new.company_id is distinct from old.company_id then
    raise exception 'a job cannot be moved between companies';
  end if;
  if new.is_featured is distinct from old.is_featured then
    raise exception 'featured placement is granted by billing, not by the owner';
  end if;
  if new.view_count is distinct from old.view_count then
    raise exception 'view_count is not owner-writable';
  end if;

  if new.status is distinct from old.status then
    ok := case old.status
      when 'draft'          then new.status in ('draft', 'pending_review')
      when 'pending_review' then new.status in ('draft', 'pending_review')
      when 'active'         then new.status = 'closed'
      when 'expired'        then new.status in ('pending_review', 'closed')
      when 'closed'         then new.status = 'pending_review'
      when 'rejected'       then new.status in ('draft', 'pending_review')
      else false
    end;

    if not ok then
      raise exception 'job status cannot go from % to %', old.status, new.status
        using hint = 'Publishing is a moderation action.';
    end if;
  end if;

  -- Editing a live post sends it back for review rather than silently changing
  -- what was already approved.
  if old.status = 'active' and new.status = 'active'
     and (new.title_ar, new.description_ar, new.basic_salary_min, new.basic_salary_max,
          new.commission_type, new.commission_value, new.leads_source, new.seats)
      is distinct from
         (old.title_ar, old.description_ar, old.basic_salary_min, old.basic_salary_max,
          old.commission_type, old.commission_value, old.leads_source, old.seats)
  then
    new.status := 'pending_review';
  end if;

  return new;
end;
$$;

-- Runs before jobs_20_enforce_post_cap, so an unauthorised transition is
-- reported as such rather than as whichever rule it happens to trip next.
create trigger jobs_10_guard_update
  before update on jobs
  for each row execute function public.guard_job_update();

-- ---------------------------------------------------------------------------
-- Applications: an employer moves the pipeline, but cannot rewrite the
-- candidate's own submission.
-- ---------------------------------------------------------------------------

create or replace function public.guard_application_update()
returns trigger
language plpgsql
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if (new.job_id, new.candidate_id, new.cv_path, new.note, new.created_at)
     is distinct from
     (old.job_id, old.candidate_id, old.cv_path, old.note, old.created_at)
  then
    raise exception 'only the application status may be changed';
  end if;

  return new;
end;
$$;

create trigger applications_guard_update
  before update on applications
  for each row execute function public.guard_application_update();

-- ---------------------------------------------------------------------------
-- Profiles: role changes are an admin action. A user picks candidate or
-- employer once, at onboarding.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role changes are an admin action';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update
  before update on profiles
  for each row execute function public.guard_profile_update();
