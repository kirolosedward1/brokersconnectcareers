-- Schema fingerprint for restore verification.
--
-- Read-only. Returns one row per object with an md5 of its definition, so a
-- restored or rebuilt database can be compared with production object by
-- object. Run the same query on both sides and diff the output.
--
-- Covers what a restore has to bring back for the platform to behave the same:
-- columns, constraints, indexes, RLS switches, policies (public and storage),
-- functions, triggers, enums and storage bucket settings.
--
-- Function bodies are compared with comments and whitespace removed: the
-- migrations applied to production were sometimes re-typed with different
-- comments, and a comment is not behaviour. Not-null constraints are left to
-- the column check, because Postgres 18 (which the in-process test database
-- runs) lists them in pg_constraint and 17 (production) does not.
with items as (
  select 'column' as kind,
         c.table_name || '.' || c.column_name as name,
         md5(concat_ws('|', c.data_type, c.udt_name, c.is_nullable, c.column_default)) as hash
    from information_schema.columns c
   where c.table_schema = 'public'
  union all
  select 'constraint', conrelid::regclass::text || '.' || conname,
         md5(pg_get_constraintdef(oid))
    from pg_constraint
   where connamespace = 'public'::regnamespace and conrelid <> 0 and contype <> 'n'
  union all
  select 'index', tablename || '.' || indexname, md5(indexdef)
    from pg_indexes where schemaname = 'public'
  union all
  select 'rls', relname, md5(relrowsecurity::text || relforcerowsecurity::text)
    from pg_class
   where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         md5(concat_ws('|', permissive, cmd, roles::text, qual, with_check))
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(concat_ws('|',
                       regexp_replace(regexp_replace(regexp_replace(p.prosrc,
                         '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g'), '\s+', '', 'g'),
                       p.prosecdef, p.provolatile, p.proconfig::text,
                       pg_get_function_result(p.oid)))
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     -- Created by Supabase's "enable RLS automatically" setting, not by a
     -- migration. The recovery runbook re-enables it by hand.
     and p.proname <> 'rls_auto_enable'
  union all
  select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
    from pg_trigger t
   where not t.tgisinternal
     and t.tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
  union all
  select 'enum', t.typname, md5(string_agg(e.enumlabel, ',' order by e.enumsortorder))
    from pg_type t join pg_enum e on e.enumtypid = t.oid
   where t.typnamespace = 'public'::regnamespace
   group by t.typname
  union all
  select 'bucket', id, md5(concat_ws('|', public, file_size_limit, allowed_mime_types::text))
    from storage.buckets
)
select kind, name, hash from items order by kind collate "C", name collate "C";
