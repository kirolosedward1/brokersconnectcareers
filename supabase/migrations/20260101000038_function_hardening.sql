-- Function hardening, from the Supabase security linter run on 2026-09-11.
--
-- Three findings, none of them a hole today, each a door left unlocked:
--
--   1. Ten functions had no search_path pinned. A SECURITY DEFINER function
--      that resolves unqualified names against whatever the caller's
--      search_path says is the textbook privilege-escalation shape; the ten
--      here are trigger guards and text helpers, and pinning costs nothing.
--
--   2. Every trigger function was EXECUTE-able by anon and authenticated over
--      /rest/v1/rpc. PostgreSQL refuses to run them outside a trigger, so this
--      was noise rather than exposure — but the grant is meaningless and the
--      linter is right that it should not exist. EXECUTE is checked when the
--      trigger is created, not when it fires, so revoking it changes nothing.
--
--   3. The signed-in-only RPCs — the admin summaries, the email log views,
--      account approval, the dashboards — were callable by anon. Each guards
--      itself (is_admin(), auth.uid()), which is why this is hygiene and not
--      a fix; but a function that only makes sense with a session should not
--      answer without one.
--
-- What deliberately keeps anon: get_agent_card, search_agents,
-- increment_job_view and employer_summary, which the site calls through the
-- session client on public pages, where the session is anon; and every helper
-- predicate used inside a policy, because a policy runs as the requesting role
-- and that role must be able to call it.

-- 1. Pin search_path wherever it is still mutable.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

-- 2. Trigger bodies are not an API.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 3. Signed-in-only RPCs answer signed-in callers and the server.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_summary', 'admin_trend',
        'email_activity', 'email_activity_summary',
        'set_account_approval',
        'candidate_summary', 'employer_trend',
        'claim_monthly_free_post', 'mark_notifications_read',
        'profile_completeness'
      )
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
