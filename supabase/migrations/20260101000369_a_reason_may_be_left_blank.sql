-- =============================================================================
-- 369 — A reason may be left blank
--
-- Every console lever asked for a reason, and several refused to move until
-- three characters were typed. A moderator who has nothing to add was stuck,
-- and a one-word note was refused. A reason is now optional everywhere
-- admin_reason is the gate: blank becomes null on the audit row, and only the
-- length ceiling remains. The argument that used to mean "required" stays in
-- the signature so every caller still compiles; it no longer raises.
--
-- A reporting ban stored its reason as not null and at least three characters.
-- That row may now be null, with the same ceiling.
--
-- profiles.is_test marks a row as ours (a seed, a QA login). Only the console
-- sets it, through admin_set_account_test. The column is added with a default,
-- so a database that already has it (another branch) is left alone.
--
-- The platform trend covered thirty days. The console now offers seven, thirty
-- and ninety, each compared with the period before it, so the function returns
-- one hundred and eighty days. A chart that still plots whatever it is given
-- keeps working.
--
-- Compatibility: the website allows an empty reason before this lands, and the
-- database still answers reason_required until it does — the action shows that
-- sentence and changes nothing. After this lands and before the new website,
-- a blank reason is stored as null and the trend simply has more points. The
-- test-account toggle stays hidden when the column or the function is missing.
-- Neither order takes the console down.
--
-- rollback: create or replace function public.admin_reason(p_reason text, p_required boolean, p_max int default 500) returns text language plpgsql immutable set search_path = public, pg_temp as $$ declare v text := nullif(btrim(p_reason), ''); begin if p_required and (v is null or length(v) < 3) then raise exception 'reason_required' using hint = 'This action needs a reason of at least three characters.'; end if; if length(v) > p_max then raise exception 'reason_too_long' using hint = format('Keep the reason under %s characters.', p_max); end if; return v; end; $$; alter table reporting_restrictions drop constraint reporting_restrictions_reason_check; update reporting_restrictions set reason = 'بدون سبب' where reason is null or length(btrim(reason)) < 3; alter table reporting_restrictions alter column reason set not null; alter table reporting_restrictions add constraint reporting_restrictions_reason_check check (length(btrim(reason)) between 3 and 500); drop function if exists public.admin_set_account_test(uuid, boolean, text); alter table profiles drop column if exists is_test; drop function if exists public.admin_search_users(text, user_role, approval_status, int, int, boolean, text, boolean); alter table profiles drop column if exists acquisition_source; then restate guard_profile_update() from migration 355, admin_search_users() from migration 355, and admin_trend() from migration 362.
-- safety: constraint, ships-with-code — the new check allows null and refuses only a reason longer than 500, and no existing row is longer than that. Code that still requires three characters keeps working against this database (it never sends a blank). Code that sends a blank before this migration is applied gets reason_required back and shows it; the test toggle is hidden when is_test or admin_set_account_test is absent; the chart plots however many days admin_trend returns. admin_search_users gains two optional arguments, so a caller that does not send them still matches; sending p_source or p_hide_test before this migration is applied fails only that filtered view. acquisition_source is a nullable column with no backfill. With the migration first, blank reasons store null, the extra trend days still draw, is_test stays false until the console sets it, and the source filter treats a null source as unknown.
-- =============================================================================

create or replace function public.admin_reason(p_reason text, p_required boolean, p_max int default 500)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := nullif(btrim(p_reason), '');
begin
  -- p_required remains so every existing caller still type-checks. A reason
  -- is optional: a blank is null, and only the ceiling is enforced.
  if length(v) > p_max then
    raise exception 'reason_too_long' using hint = format('Keep the reason under %s characters.', p_max);
  end if;
  return v;
end;
$$;

revoke execute on function public.admin_reason(text, boolean, int) from public, anon, authenticated;

alter table reporting_restrictions drop constraint reporting_restrictions_reason_check;
alter table reporting_restrictions alter column reason drop not null;
alter table reporting_restrictions add constraint reporting_restrictions_reason_check
  check (reason is null or (length(btrim(reason)) <= 500 and length(btrim(reason)) >= 1));

-- ---------------------------------------------------------------------------
-- A row that is ours
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists is_test boolean not null default false;

comment on column profiles.is_test is
  'Ours: a seed, a QA login, or the store-review account. Set only from the console.';

alter table profiles
  add column if not exists acquisition_source text;

comment on column profiles.acquisition_source is
  'How the account arrived (google, referral, …). Null is unknown. Not written by the account itself.';

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- The mark is the console's. A migration has no JWT, so a backfill passes.
  if new.is_test is distinct from old.is_test
     and coalesce(current_setting('app.admin_console', true), 'off') <> 'on'
     and nullif(current_setting('request.jwt.claims', true), '') is not null then
    raise exception 'is_test is an admin action';
  end if;

  if new.acquisition_source is distinct from old.acquisition_source
     and coalesce(current_setting('app.admin_console', true), 'off') <> 'on'
     and nullif(current_setting('request.jwt.claims', true), '') is not null then
    raise exception 'acquisition_source is not user-writable';
  end if;

  if public.acting_as_admin() then
    if new.id = (select auth.uid())
       and (new.role, new.approval_status, new.approved_at)
           is distinct from
           (old.role, old.approval_status, old.approved_at)
    then
      raise exception 'an admin cannot change their own approval';
    end if;

    if new.role is distinct from old.role
       and public.is_admin()
       and coalesce(current_setting('app.admin_console', true), 'off') <> 'on'
    then
      raise exception 'role changes go through admin_set_role';
    end if;

    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role changes are an admin action';
  end if;

  if (new.approval_status, new.approved_at)
     is distinct from
     (old.approval_status, old.approved_at)
  then
    raise exception 'approval is an admin action';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not user-writable';
  end if;

  return new;
end;
$$;

create or replace function public.admin_set_account_test(
  p_user   uuid,
  p_test   boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  uuid;
  v_reason text;
  v_name   text;
begin
  v_actor := public.admin_begin();

  if p_user = v_actor then
    raise exception 'forbidden' using hint = 'An admin cannot mark their own account.';
  end if;

  select full_name into v_name from profiles where id = p_user for update;
  if not found then
    raise exception 'not_found';
  end if;

  v_reason := public.admin_reason(p_reason, false);

  update profiles
     set is_test = p_test
   where id = p_user
     and is_test is distinct from p_test;
  if not found then
    raise exception 'no_change';
  end if;

  perform public.admin_audit(
    case when p_test then 'user.test_marked' else 'user.test_cleared' end,
    'user', p_user::text, v_name, v_reason, '{}'::jsonb);
end;
$$;

revoke execute on function public.admin_set_account_test(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_account_test(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- One hundred and eighty days, so ninety can be compared with the ninety before
-- ---------------------------------------------------------------------------

create or replace function public.admin_trend()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_days  jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'd',            to_char(g.day, 'YYYY-MM-DD'),
               'signups',      coalesce(s.n, 0),
               'published',    coalesce(p.n, 0),
               'applications', coalesce(a.n, 0)
             ) order by g.day
           ),
           '[]'::jsonb
         )
    into v_days
  from generate_series(v_today - 179, v_today, interval '1 day') as g(day)
  left join (
    select (created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from profiles group by 1
  ) s on s.day = g.day::date
  left join (
    select (published_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from jobs where published_at is not null group by 1
  ) p on p.day = g.day::date
  left join (
    select (created_at at time zone 'Africa/Cairo')::date as day, count(*)::int as n
      from applications
     where status <> 'withdrawn'
     group by 1
  ) a on a.day = g.day::date;

  return jsonb_build_object('days', v_days);
end;
$$;

-- ---------------------------------------------------------------------------
-- Search can keep a source and leave the test rows out. The extra arguments
-- default, so a caller that does not send them still matches.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_search_users(text, user_role, approval_status, int, int, boolean);

create or replace function public.admin_search_users(
  p_query     text default null,
  p_role      user_role default null,
  p_status    approval_status default null,
  p_limit     int default 25,
  p_offset    int default 0,
  p_blocked   boolean default null,
  p_source    text default null,
  p_hide_test boolean default false
)
returns table (
  id               uuid,
  role             user_role,
  full_name        text,
  avatar_url       text,
  approval_status  approval_status,
  approval_note    text,
  created_at       timestamptz,
  company_id       uuid,
  company_name_ar  text,
  company_name_en  text,
  agent_slug       text,
  agent_restricted boolean,
  total_count      bigint,
  sign_in_blocked  boolean,
  last_sign_in_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_q      text := nullif(btrim(p_query), '');
  v_uuid   uuid;
  v_email  uuid;
  v_digits text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_q::uuid;
  end if;
  if position('@' in coalesce(v_q, '')) > 0 then
    select u.id into v_email from auth.users u where lower(u.email) = lower(v_q) limit 1;
  end if;
  if v_q ~ '^[+0-9 ()-]+$' then
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    if length(v_digits) < 6 then v_digits := null; end if;
    v_digits := regexp_replace(v_digits, '^0', '');
  end if;

  return query
    select p.id, p.role, p.full_name, p.avatar_url, p.approval_status, pp.approval_note,
           p.created_at, c.id, c.name_ar, c.name_en, a.slug, a.restricted_at is not null,
           count(*) over (),
           u.banned_until is not null and u.banned_until > now(),
           u.last_sign_in_at
      from profiles p
      left join profile_private pp on pp.user_id = p.id
      left join auth.users u on u.id = p.id
      left join lateral (
        select co.id, co.name_ar, co.name_en
          from company_members m
          join companies co on co.id = m.company_id
         where m.user_id = p.id
         order by (m.role = 'admin') desc, m.created_at
         limit 1
      ) c on true
      left join agent_profiles a on a.user_id = p.id
     where (p_role is null or p.role = p_role)
       and (p_status is null or p.approval_status = p_status)
       and (p_blocked is null or (u.banned_until is not null and u.banned_until > now()) = p_blocked)
       and (
         p_source is null
         or (p_source = 'unknown' and p.acquisition_source is null)
         or p.acquisition_source = p_source
       )
       and (not coalesce(p_hide_test, false) or p.is_test = false)
       and (
         v_q is null
         or (v_uuid is not null and p.id = v_uuid)
         or (v_email is not null and p.id = v_email)
         or (v_digits is not null and p.whatsapp_phone like '%' || v_digits || '%')
         or p.full_name ilike public.admin_like_pattern(v_q)
         or public.ar_normalise(p.full_name) ilike public.admin_like_pattern(public.ar_normalise(v_q))
       )
     order by (p.approval_status = 'pending') desc, p.created_at desc, p.id desc
     limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
end;
$$;

revoke execute on function public.admin_search_users(text, user_role, approval_status, int, int, boolean, text, boolean) from public, anon;
grant  execute on function public.admin_search_users(text, user_role, approval_status, int, int, boolean, text, boolean) to authenticated;
