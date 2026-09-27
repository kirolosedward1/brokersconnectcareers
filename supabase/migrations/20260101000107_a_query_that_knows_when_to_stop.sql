-- =============================================================================
-- 107 — A query that knows when to stop
--
-- Nothing bounded how long a request could hold a connection. A pathological
-- search — or a deliberate one — could sit on the pool until the pooler gave
-- up, and every honest reader behind it would wait. Supabase applies no
-- statement timeout to the API roles by default; these are the values the
-- platform's own guidance suggests, set per role so a migration run as
-- postgres is unaffected.
--
-- Postgres reads a role's settings when a session starts, so PostgREST picks
-- these up on its next connection. `notify pgrst` asks it not to wait.
--
-- Two indexes for shapes the queries above created: the directory's order,
-- which is by experience and then age over a partial set, and the per-company
-- day count the listing cap reads.
-- =============================================================================

do $$
begin
  execute $q$alter role anon set statement_timeout = '5s'$q$;
  execute $q$alter role authenticated set statement_timeout = '10s'$q$;
exception when others then
  raise notice 'statement_timeout not applied: %', sqlerrm;
end $$;

create index if not exists agent_profiles_directory_order_idx
  on agent_profiles (years_experience desc, created_at desc, id)
  where visibility <> 'hidden';

create index if not exists jobs_company_created_idx
  on jobs (company_id, created_at desc);

do $$
begin
  perform pg_notify('pgrst', 'reload config');
exception when others then
  null;
end $$;
