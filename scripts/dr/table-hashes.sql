-- Row count and content hash for every table a restore brings back.
--
-- Read-only (the helper lives in pg_temp and disappears with the session).
-- The hash is over each row's text form in a fixed order, so two databases
-- with the same schema and the same rows produce the same line.
--
-- From auth, only the columns accounts depend on are hashed: a new project can
-- run a newer auth server with extra columns, and that is not data loss.
create or replace function pg_temp.dr_hash(q text) returns table (n bigint, hash text)
language plpgsql as $fn$
begin
  return query execute format(
    'select count(*), coalesce(md5(string_agg(t::text, E''\n'' order by t::text collate "C")), '''')
       from (%s) t', q);
end;
$fn$;

select name, h.n, h.hash
  from (
    select c.oid::regclass::text as name, format('select * from %s', c.oid::regclass) as q
      from pg_class c
     where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
    union all
    select 'auth.users',
           'select id, email, encrypted_password, email_confirmed_at, created_at from auth.users'
  ) tables
  cross join lateral pg_temp.dr_hash(tables.q) h
 order by name collate "C";
