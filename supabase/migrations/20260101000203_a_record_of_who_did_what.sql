-- =============================================================================
-- 68 — A record of who did what
--
-- Every moderation lever the console has — approving a listing, verifying a
-- company, suspending an account — changed a row and left no trace of the
-- person who pulled it. reports.resolved_by and company_documents.reviewed_by
-- say who closed a complaint or read a tax card; nothing says who took a
-- listing down, who suspended a company, or why. When an employer asks where
-- their advert went, the honest answer today is "somebody, at some point".
--
-- Two tables, both append-only:
--
--   admin_audit_log    what an admin did, to what, when, and the reason they
--                      gave. Written by the admin_* functions in migration 70
--                      inside the same transaction as the change itself, so
--                      a decision and its record commit or fail together.
--
--   moderation_notes   what an admin wrote down while investigating — "called
--                      the company, waiting on the register" — against any
--                      account, company, listing or consultant. Internal: no
--                      policy lets anybody but an admin read it, which is why
--                      it is its own table rather than a column on reports
--                      (the reporter can read their own report row).
--
-- actor_id carries no foreign key on purpose. An audit record has to outlive
-- the account that made it, and `on delete set null` would be an UPDATE the
-- append-only trigger below refuses — so deleting a former moderator's
-- account would fail. The name is snapshotted beside the id for the same
-- reason: the row must still say who, after the profile is gone.
--
-- What is never written here: passwords, tokens, CV contents, documents,
-- secret keys. The writer takes a short reason and a small metadata object;
-- callers pass status transitions and counts, never row dumps. The size check
-- on metadata is the backstop that makes a careless caller fail loudly.
-- =============================================================================

-- rollback: forward-fix only — applied to production on 2026-09-27 (17:07–17:10 UTC), before any branch carrying it merged; undoing it is a new migration, never an edit to this one
-- safety: ships-with-code — already applied to production on 2026-09-27 (17:07–17:10 UTC); the code on main has run against it since, and this branch's code that reads it can land at any time

create table if not exists admin_audit_log (
  id            bigint generated always as identity primary key,
  actor_id      uuid,
  actor_name    text,
  action        text not null
                check (action ~ '^[a-z_]+\.[a-z_]+$' and length(action) <= 64),
  target_type   text not null
                check (target_type in ('user', 'company', 'job', 'agent', 'application', 'report', 'taxonomy')),
  target_id     text not null check (length(target_id) between 1 and 64),
  target_label  text check (length(target_label) <= 200),
  reason        text check (length(reason) <= 1000),
  metadata      jsonb not null default '{}'::jsonb
                check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  -- 'console' when the change went through an admin_* function; 'direct' when
  -- an admin wrote the table through the API and the safety net below caught it.
  via           text not null default 'console' check (via in ('console', 'direct')),
  created_at    timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx  on admin_audit_log (target_type, target_id, created_at desc);
create index if not exists admin_audit_log_actor_idx   on admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_log_action_idx  on admin_audit_log (action, created_at desc);

alter table admin_audit_log enable row level security;

drop policy if exists admin_audit_log_select on admin_audit_log;
create policy admin_audit_log_select on admin_audit_log
  for select using (public.is_admin());

-- No insert, update or delete policy for anybody. The only writer is
-- admin_audit(), which runs as its definer.
revoke insert, update, delete, truncate on admin_audit_log from anon, authenticated;

create table if not exists moderation_notes (
  id           bigint generated always as identity primary key,
  target_type  text not null
               check (target_type in ('user', 'company', 'job', 'agent', 'application', 'report', 'taxonomy')),
  target_id    text not null check (length(target_id) between 1 and 64),
  author_id    uuid,
  author_name  text,
  body         text not null check (length(btrim(body)) between 1 and 2000),
  created_at   timestamptz not null default now()
);

create index if not exists moderation_notes_target_idx on moderation_notes (target_type, target_id, created_at desc);
create index if not exists moderation_notes_author_idx on moderation_notes (author_id);

alter table moderation_notes enable row level security;

drop policy if exists moderation_notes_select on moderation_notes;
create policy moderation_notes_select on moderation_notes
  for select using (public.is_admin());

revoke insert, update, delete, truncate on moderation_notes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Append-only, for everybody — the service role included. A record that its
-- own subject can edit is not a record.
-- ---------------------------------------------------------------------------

create or replace function public.refuse_rewriting_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'append_only'
    using hint = format('%s is append-only.', tg_table_name);
end;
$$;

revoke execute on function public.refuse_rewriting_history() from public, anon, authenticated;

drop trigger if exists admin_audit_log_10_append_only on admin_audit_log;
create trigger admin_audit_log_10_append_only
  before update or delete on admin_audit_log
  for each row execute function public.refuse_rewriting_history();

drop trigger if exists admin_audit_log_11_no_truncate on admin_audit_log;
create trigger admin_audit_log_11_no_truncate
  before truncate on admin_audit_log
  for each statement execute function public.refuse_rewriting_history();

drop trigger if exists moderation_notes_10_append_only on moderation_notes;
create trigger moderation_notes_10_append_only
  before update or delete on moderation_notes
  for each row execute function public.refuse_rewriting_history();

drop trigger if exists moderation_notes_11_no_truncate on moderation_notes;
create trigger moderation_notes_11_no_truncate
  before truncate on moderation_notes
  for each statement execute function public.refuse_rewriting_history();

-- ---------------------------------------------------------------------------
-- The one writer
--
-- Not callable by any API role. The admin_* functions in migration 70 call it
-- as their definer, after they have checked is_admin() and made the change.
-- ---------------------------------------------------------------------------

create or replace function public.admin_audit(
  p_action       text,
  p_target_type  text,
  p_target_id    text,
  p_target_label text default null,
  p_reason       text default null,
  p_metadata     jsonb default '{}'::jsonb,
  p_via          text default 'console'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  insert into admin_audit_log
    (actor_id, actor_name, action, target_type, target_id, target_label, reason, metadata, via)
  values (
    v_actor,
    (select full_name from profiles where id = v_actor),
    p_action,
    p_target_type,
    p_target_id,
    left(p_target_label, 200),
    nullif(btrim(p_reason), ''),
    coalesce(p_metadata, '{}'::jsonb),
    p_via
  );
end;
$$;

revoke execute on function public.admin_audit(text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The safety net: an admin who goes round the console is still recorded
--
-- The *_admin_all policies let an admin write these tables directly through
-- the API, and taking that away would break the employer console for an admin
-- who also runs a company. So the write stays possible and stops being
-- invisible: a change to a moderation-relevant column made under an admin's
-- JWT, outside an admin_* function, is logged with via = 'direct' and the
-- columns it touched.
--
-- The admin_* functions set a transaction-local marker (migration 41's
-- pattern: only a definer function can set it, and PostgREST gives a client
-- no statement to) so their own writes are not logged twice. The service role
-- has no auth.uid(), so is_admin() is false for it and crons are not logged —
-- those are the platform, not a person.
--
-- The watched columns are the trigger's arguments, so each table states its
-- own list where the trigger is created. suspended_at and restricted_at arrive
-- in migration 69; naming them here first is harmless, because a column that
-- does not exist yet simply never appears among the changed keys.
-- ---------------------------------------------------------------------------

create or replace function public.audit_direct_admin_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type    text := tg_argv[0];
  v_label   text := tg_argv[1];
  v_watch   text[] := tg_argv[2:];
  v_changed text[];
  v_row     jsonb;
begin
  if coalesce(current_setting('app.admin_console', true), 'off') = 'on' then
    return null;
  end if;
  if not public.is_admin() then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
    perform public.admin_audit(
      v_type || '.direct_delete', v_type, v_row ->> 'id', v_row ->> v_label, null,
      '{}'::jsonb, 'direct');
    return null;
  end if;

  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
   where n.key = any (v_watch)
     and n.value is distinct from o.value;

  if cardinality(v_changed) = 0 then
    return null;
  end if;

  v_row := to_jsonb(new);
  perform public.admin_audit(
    v_type || '.direct_update', v_type, v_row ->> 'id', v_row ->> v_label, null,
    jsonb_build_object(
      'columns', to_jsonb(v_changed),
      'from', (select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(old)) where key = any (v_changed)),
      'to',   (select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(new)) where key = any (v_changed))
    ),
    'direct');
  return null;
end;
$$;

revoke execute on function public.audit_direct_admin_write() from public, anon, authenticated;

drop trigger if exists jobs_90_audit_direct_admin_write on jobs;
create trigger jobs_90_audit_direct_admin_write
  after update or delete on jobs
  for each row execute function public.audit_direct_admin_write(
    'job', 'title_ar', 'status', 'is_featured', 'featured_until', 'expires_at', 'rejection_note', 'company_id');

drop trigger if exists companies_90_audit_direct_admin_write on companies;
create trigger companies_90_audit_direct_admin_write
  after update or delete on companies
  for each row execute function public.audit_direct_admin_write(
    'company', 'name_ar', 'verification_status', 'verified_at', 'post_credits', 'owner_id', 'slug', 'suspended_at');

drop trigger if exists profiles_90_audit_direct_admin_write on profiles;
create trigger profiles_90_audit_direct_admin_write
  after update or delete on profiles
  for each row execute function public.audit_direct_admin_write(
    'user', 'full_name', 'role', 'approval_status', 'approval_note');

drop trigger if exists agent_profiles_90_audit_direct_admin_write on agent_profiles;
create trigger agent_profiles_90_audit_direct_admin_write
  after update or delete on agent_profiles
  for each row execute function public.audit_direct_admin_write(
    'agent', 'slug', 'visibility', 'user_id', 'restricted_at');
