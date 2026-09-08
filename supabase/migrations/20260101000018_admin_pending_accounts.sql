-- =============================================================================
-- 18 — The admin summary learns about pending accounts
--
-- admin_summary() was written in migration 13, before accounts could be held
-- for review at all. It counts listings waiting, companies waiting on
-- documents and reports open — every queue except the one migration 16 added.
--
-- The console is about to put these counts on the navigation itself, so a
-- moderator can see what is waiting without opening each queue to find out.
-- A queue missing from the summary would be a queue missing from that list.
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
    'reports_open',     (select count(*) from reports where not resolved),
    'companies_pending',(select count(*) from companies where verification_status = 'pending'),
    -- New. Employer accounts sitting between signing up and being allowed to
    -- post anything, which is the queue that blocks somebody entirely.
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
