-- =============================================================================
-- 52 — A shortlisted candidate who disappears from the inbox
--
-- Withdrawing deletes the application — migration 42 settled who may and when:
-- the candidate, while the outcome is still open, meaning `new` or
-- `shortlisted`. `shortlisted` is the half that matters here. An employer who
-- has picked somebody out, and may be about to call them, finds the row simply
-- gone: no notice, no record, and nothing to distinguish it from having
-- misremembered.
--
-- The candidate is already told — notifyApplicationWithdrawn mails them their
-- own receipt. The company was told nothing at all.
--
-- Fires from the delete itself rather than from withdrawApplication, so it
-- cannot be skipped by a request that does not go through the action, and so
-- it records what actually happened rather than what was asked for. It says
-- which listing and nothing about the person beyond the name the employer
-- already had: a withdrawal is not the moment to hand out anything new.
-- =============================================================================

create or replace function public.on_application_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  -- Only while somebody was still considering them. A withdrawal from `new` is
  -- a person changing their mind before anybody looked, and an inbox notice
  -- for it is noise; from `shortlisted` it is a candidate the employer had
  -- already chosen.
  if old.status <> 'shortlisted' then
    return old;
  end if;

  select j.id, j.title_ar, j.title_en, j.company_id
    into v_job
    from jobs j
   where j.id = old.job_id;

  if v_job.id is null then
    -- The listing went with it — a company deleting itself cascades through
    -- both, and nobody needs telling about their own deletion.
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
    '/employer/jobs/' || v_job.id || '/applicants'
  );

  return old;
end;
$$;

revoke execute on function public.on_application_withdrawn() from public, anon, authenticated;

drop trigger if exists applications_notify_withdrawal on applications;

create trigger applications_notify_withdrawal
  after delete on applications
  for each row execute function public.on_application_withdrawn();
