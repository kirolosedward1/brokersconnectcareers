-- =============================================================================
-- 212 — What the security page reads
--
-- One round trip for the admin's security overview, the way admin_summary()
-- draws the moderation one. Counts only, over the last day: what the
-- platform noticed (security_events by kind), how many contacts were handed
-- out and to whom, and the account, report and queue figures that give those
-- numbers a scale. The rows themselves — the audit trail, the event list —
-- are read straight from their tables under the admin policies.
-- =============================================================================

-- rollback: drop function if exists public.security_summary();
-- safety: ships-with-code — a new admin-only function read by one new admin page and
--   nothing else, so either order is safe.

create or replace function public.security_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz := now() - interval '24 hours';
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'window_hours', 24,
    'events_by_kind', coalesce((
      select jsonb_agg(jsonb_build_object('kind', kind, 'count', n) order by n desc, kind)
        from (select kind, count(*)::int as n from security_events
               where created_at > v_since group by kind) k
    ), '[]'::jsonb),
    'events_total',    (select count(*) from security_events where created_at > v_since),
    'events_warning',  (select count(*) from security_events where created_at > v_since and severity = 'warning'),
    'events_critical', (select count(*) from security_events where created_at > v_since and severity = 'critical'),
    'reveals_24h',     (select count(*) from agent_contact_reveals where created_at > v_since),
    'reveals_top_viewers', coalesce((
      select jsonb_agg(jsonb_build_object('viewer_id', viewer_id, 'count', n) order by n desc)
        from (select viewer_id, count(*)::int as n from agent_contact_reveals
               where created_at > v_since group by viewer_id order by n desc limit 5) v
    ), '[]'::jsonb),
    'rate_limited_24h', (select count(*) from security_events
                          where created_at > v_since and kind like '%rate_limited%'),
    'uploads_rejected_24h', (select count(*) from security_events
                              where created_at > v_since and kind like 'upload.%'),
    'auth_failures_24h', (select count(*) from security_events
                           where created_at > v_since and kind like 'auth.%'),
    'accounts_suspended', (select count(*) from profiles where approval_status = 'rejected'),
    'accounts_pending',   (select count(*) from profiles where approval_status = 'pending'),
    'reports_open',       (select count(distinct job_id) from reports where not resolved),
    'jobs_pending',       (select count(*) from jobs where status = 'pending_review'),
    'signups_24h',        (select count(*) from profiles where created_at > v_since),
    'applications_24h',   (select count(*) from applications where created_at > v_since)
  );
end;
$$;

revoke execute on function public.security_summary() from public, anon;
grant  execute on function public.security_summary() to authenticated, service_role;
