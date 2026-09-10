-- =============================================================================
-- 36 — The dashboard learns what the digest email already knew
--
-- `employer_viewed_at is null` is this schema's definition of an applicant
-- nobody has opened. Migration 28 wrote it and the daily digest email has been
-- counting it ever since — so the platform emails a company "you have three
-- unseen applicants" and then shows them a dashboard with no such number on it.
--
-- The nearest thing on screen was `applicants_new`, which counts status = 'new'
-- and is a different fact: an employer can open somebody, read their CV, decide
-- to think about it and leave the status alone. Treating "not moved" as "not
-- seen" overstates the backlog and, worse, disagrees with the email.
--
-- One more count, from the same definition, so the two agree.
-- =============================================================================

create or replace function public.employer_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_result  jsonb;
begin
  select id into v_company from companies where owner_id = auth.uid();

  if v_company is null then
    return jsonb_build_object('has_company', false);
  end if;

  select jsonb_build_object(
    'has_company',       true,
    'live_jobs',         count(*) filter (where j.status = 'active'
                                            and (j.expires_at is null or j.expires_at > now())),
    'pending_jobs',      count(*) filter (where j.status = 'pending_review'),
    'draft_jobs',        count(*) filter (where j.status = 'draft'),
    'expiring_soon',     count(*) filter (where j.status = 'active'
                                            and j.expires_at is not null
                                            and j.expires_at between now() and now() + interval '7 days'),
    'total_views',       coalesce(sum(j.view_count), 0),
    'seats_advertised',  coalesce(sum(j.seats) filter (where j.status = 'active'), 0)
  ) into v_result
  from jobs j
  where j.company_id = v_company;

  return v_result || jsonb_build_object(
    'applicants_total',  (select count(*) from applications a
                            join jobs j on j.id = a.job_id
                           where j.company_id = v_company),
    'applicants_new',    (select count(*) from applications a
                            join jobs j on j.id = a.job_id
                           where j.company_id = v_company and a.status = 'new'),
    -- New. Never opened by anybody at this company, which is the same test the
    -- applicant digest uses when it decides whether to write at all.
    'applicants_unseen', (select count(*) from applications a
                            join jobs j on j.id = a.job_id
                           where j.company_id = v_company
                             and a.employer_viewed_at is null),
    'applicants_7d',     (select count(*) from applications a
                            join jobs j on j.id = a.job_id
                           where j.company_id = v_company
                             and a.created_at > now() - interval '7 days'),
    'applicants_prev_7d',(select count(*) from applications a
                            join jobs j on j.id = a.job_id
                           where j.company_id = v_company
                             and a.created_at between now() - interval '14 days'
                                                 and now() - interval '7 days'),
    'credits',           (select post_credits from companies where id = v_company),
    'verification',      (select verification_status::text from companies where id = v_company)
  );
end;
$$;

revoke execute on function public.employer_summary() from public, anon;
grant  execute on function public.employer_summary() to authenticated, service_role;
