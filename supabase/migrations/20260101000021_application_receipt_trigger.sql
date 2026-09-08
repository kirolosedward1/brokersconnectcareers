-- =============================================================================
-- 21 — Tell the candidate their application landed
--
-- A separate file from the one that added `application_submitted`, and it has
-- to be: Postgres will not let a transaction use an enum value the same
-- transaction added, and db-push.mjs wraps each migration in its own
-- transaction. Splitting the pair is what makes both halves safe.
-- =============================================================================

create or replace function public.on_application_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job   record;
  v_owner uuid;
begin
  select j.id, j.slug, j.title_ar, j.title_en, c.owner_id, c.name_ar, c.name_en
    into v_job
    from jobs j join companies c on c.id = j.company_id
   where j.id = new.job_id;

  v_owner := v_job.owner_id;

  -- The employer, as before.
  perform public.notify(
    v_owner,
    'application_received',
    jsonb_build_object(
      'job_id',    v_job.id,
      'title_ar',  v_job.title_ar,
      'title_en',  v_job.title_en
    ),
    '/employer/jobs/' || v_job.id || '/applicants'
  );

  -- And the applicant, which is the new half. The company travels in the
  -- payload because "your application to X at Y" is the sentence somebody
  -- wants back, and the notification feed is bilingual — so it stores the
  -- data and lets the reader's locale pick the words, the way the other six
  -- kinds already do.
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
