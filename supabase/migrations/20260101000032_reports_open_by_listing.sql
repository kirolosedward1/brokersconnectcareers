-- =============================================================================
-- 32 — The reports badge counts listings, not complaints
--
-- The moderation queue now groups reports by the listing they are about,
-- because there is a unique index on (job_id, reporter_id) and five reports on
-- one advert are five people describing one problem. The badge on the
-- navigation kept counting rows, so it read "4" over a queue holding two
-- cards — and the number a reviewer plans their morning around was the one
-- that was wrong.
--
-- Everything else in the summary is unchanged; the function has to be restated
-- in full because Postgres has no way to replace one expression inside it.
-- =============================================================================

create or replace function public.admin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'queue_total',      (select count(*) from jobs where status = 'pending_review'),
    -- Queue depth by age is the number that says whether moderation is
    -- keeping up; a total alone hides a backlog that is not moving.
    'queue_over_24h',   (select count(*) from jobs
                          where status = 'pending_review' and created_at < now() - interval '24 hours'),
    -- Distinct listings, which is the number of decisions waiting to be made.
    'reports_open',     (select count(distinct job_id) from reports where not resolved),
    'companies_pending',(select count(*) from companies where verification_status = 'pending'),
    'accounts_pending', (select count(*) from profiles where approval_status = 'pending'),
    'companies_total',  (select count(*) from companies),
    'live_jobs',        (select count(*) from jobs
                          where status = 'active' and (expires_at is null or expires_at > now())),
    'candidates',       (select count(*) from profiles where role = 'candidate'),
    'employers',        (select count(*) from profiles where role = 'employer'),
    'signups_7d',       (select count(*) from profiles where created_at > now() - interval '7 days'),
    'published_7d',     (select count(*) from jobs where published_at > now() - interval '7 days'),
    'applications_7d',  (select count(*) from applications where created_at > now() - interval '7 days')
  );
end;
$$;
