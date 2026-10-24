-- =============================================================================
-- 370 — A critical security event reaches a person, and the week is summed up
--
-- security_events has a severity, and nothing read the critical ones but the
-- /admin/security page, when somebody opened it (RUNBOOKS.md §D: "none are
-- emitted automatically today ... wire a database webhook on insert"). This
-- is the wiring, through the platform's own outbox rather than a second
-- channel to run: api/cron/security-watch reads what is due every ten
-- minutes, emails every admin, and marks it sent; on Mondays it also sends
-- the week's digest.
--
--   security_events.alerted_at     set once the alert has gone out
--   security_alerts_due(limit)     critical events not yet sent, newest week
--   mark_security_alerted(ids)     what the watcher sent
--   security_digest(days)          the week in numbers, for the digest email
--
-- And one critical event that did not exist: an account becoming an admin,
-- by any path — the lever, the dashboard's SQL editor, a seed. A new admin
-- is the first thing a takeover of the console makes, and the one change
-- worth a page within minutes.
--
-- All four functions are the service role's alone (the watcher); the
-- trigger writes as its owner.
-- =============================================================================

-- rollback: drop trigger if exists profiles_96_made_admin on profiles; drop function if exists public.flag_made_admin(), public.security_alerts_due(int), public.mark_security_alerted(bigint[]), public.security_digest(int); alter table security_events drop column if exists alerted_at;
-- safety: ships-with-code — the column is nullable and read only by the new watcher; the trigger adds a row to security_events, which the admin page already lists. Without the code the events wait, unsent, which is today's state
-- safety: definer — the trigger function writes one security_events row as its owner, search_path pinned; the four functions are revoked from public, anon and authenticated and serve only the service role

alter table security_events add column if not exists alerted_at timestamptz;

create index if not exists security_events_alert_due_idx
  on security_events (id) where severity = 'critical' and alerted_at is null;

create or replace function public.flag_made_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'admin' and (tg_op = 'INSERT' or old.role is distinct from 'admin') then
    insert into security_events (kind, severity, actor_id, metadata)
    values (
      'account.made_admin',
      'critical',
      auth.uid(),
      jsonb_build_object(
        'target', new.id,
        -- No token at all: the SQL editor, a migration, a seed or the
        -- service role. Worth saying, because the lever always has one.
        'path', case when auth.uid() is null then 'direct' else 'session' end
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_96_made_admin on profiles;
create trigger profiles_96_made_admin
  after insert or update of role on profiles
  for each row execute function public.flag_made_admin();

create or replace function public.security_alerts_due(p_limit int default 20)
returns setof security_events
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from security_events
   where severity = 'critical'
     and alerted_at is null
     and created_at > now() - interval '7 days'
   order by id
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create or replace function public.mark_security_alerted(p_ids bigint[])
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  with marked as (
    update security_events set alerted_at = now()
     where id = any (p_ids) and alerted_at is null
    returning 1
  )
  select count(*)::int from marked;
$$;

create or replace function public.security_digest(p_days int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 31));
begin
  return jsonb_build_object(
    'days', least(greatest(coalesce(p_days, 7), 1), 31),
    'auth_failures', (select count(*) from security_events where created_at > v_since and kind like 'auth.%'),
    'rate_limited',  (select count(*) from security_events where created_at > v_since and kind like '%rate_limited%'),
    'uploads_rejected', (select count(*) from security_events where created_at > v_since and kind like 'upload.%'),
    'critical',      (select count(*) from security_events where created_at > v_since and severity = 'critical'),
    'warnings',      (select count(*) from security_events where created_at > v_since and severity = 'warning'),
    'reveals',       (select count(*) from agent_contact_reveals where created_at > v_since),
    'reveals_by_company', coalesce((
      select jsonb_agg(jsonb_build_object('company', name_ar, 'count', n) order by n desc)
        from (select coalesce(c.name_ar, '—') as name_ar, count(*)::int as n
                from agent_contact_reveals r left join companies c on c.id = r.company_id
               where r.created_at > v_since
               group by c.name_ar order by n desc limit 10) top
    ), '[]'::jsonb),
    'new_admins', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.created_at, 'name', p.full_name, 'path', e.metadata->>'path') order by e.id)
        from security_events e left join profiles p on p.id = (e.metadata->>'target')::uuid
       where e.created_at > v_since and e.kind = 'account.made_admin'
    ), '[]'::jsonb),
    'admins_now', (select count(*) from profiles where role = 'admin')
  );
end;
$$;

revoke execute on function public.flag_made_admin() from public, anon, authenticated;
revoke execute on function public.security_alerts_due(int), public.mark_security_alerted(bigint[]),
  public.security_digest(int) from public, anon, authenticated;
grant execute on function public.security_alerts_due(int), public.mark_security_alerted(bigint[]),
  public.security_digest(int) to service_role;
