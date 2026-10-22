/*
  Accounts managed from one place.

  The accounts page (the website's /admin/users, the app's Accounts screen)
  grows from "approve, hold, suspend" into the console's one place for an
  account: what it is (role, standing, how and where it signs in), what it
  has done, and the levers an operator reaches for when support or safety
  calls. Each lever is a SECURITY DEFINER function behind admin_begin()
  (migration 318): it refuses anybody who is not an admin, refuses what the
  product does not have, needs a reason where one is owed, and writes its
  audit record in the same transaction as the change.

    admin_search_users       + p_blocked, to list the accounts whose sign-in
                               is blocked; each row now says whether it is,
                               and when the account last signed in
    admin_user_facts         + whether two-step sign-in is on, how many
                               devices are signed in, and until when sign-in
                               is blocked
    admin_user_activity      what the account has done, in counts: its
                               applications by stage, its companies' listings
                               by status, the reports it filed (and how many
                               came to nothing), its appeals, what it saved,
                               and the notes and decisions on its record
    admin_set_role           make an approved account an admin, or an admin a
                               candidate or employer again — never yourself,
                               never the last admin, always with a reason.
                               Nobody is emailed: an admin is told by an
                               admin. And the only way a role changes under
                               an admin's hand (the guard, at the end).
    admin_set_sign_in_block  the auth server's own ban (auth.users.banned_until)
                               — the account cannot sign in until it is
                               lifted, and every device signed in is signed
                               out — and lifting it. Listings and
                               applications are untouched: suspension
                               (set_account_approval) is the lever for the
                               account's standing, this one is for the door.
    admin_end_sessions       sign the account out of every device; it can sign
                               in again at once

  Sign-in blocks and sessions live in the auth schema, which GoTrue owns. The
  functions touch exactly what GoTrue's admin API would — banned_until, the
  sessions and their refresh tokens — by name, and the sessions only when the
  table is there: the test database (supabase/tests/setup.mjs) stubs
  auth.users without it. A refresh refused because its session is gone signs
  the phone and the browser out on their next refresh; an access token
  already issued lasts until it expires, within the hour.
*/

-- rollback: drop function public.admin_set_sign_in_block(uuid, boolean, text), public.admin_end_sessions(uuid, text), public.admin_end_sessions_of(uuid), public.admin_set_role(uuid, user_role, text), public.admin_user_activity(uuid), public.admin_search_users(text, user_role, approval_status, int, int, boolean); then restate admin_search_users (5 arguments) from migration 346, admin_user_facts from migration 318, with their revoke/grant lines, and guard_profile_update() from migration 305
-- safety: ships-with-code — the code on this branch works against either database. The website's users page calls admin_search_users with named arguments, so the 5-argument function answers it until this lands (only the "sign-in blocked" view, which alone sends p_blocked, would be refused), and reads the new row fields and admin_user_facts fields as absent; the app treats a missing admin_user_activity (PGRST202/42883) as "not migrated" and draws the file without it. The new levers (role, sign-in block, sessions) are reached only through the website's server actions and the app's registry, which are deployed with this branch, and each refuses anyone but an admin behind admin_begin(). With the migration first and the old code, nothing calls the new functions; the replaced ones keep their old arguments' meaning

-- ---------------------------------------------------------------------------
-- The list: + sign-in blocked, last sign-in
-- ---------------------------------------------------------------------------

drop function if exists public.admin_search_users(text, user_role, approval_status, int, int);

create or replace function public.admin_search_users(
  p_query   text default null,
  p_role    user_role default null,
  p_status  approval_status default null,
  p_limit   int default 25,
  p_offset  int default 0,
  p_blocked boolean default null
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
    -- Stored as +20…; somebody pastes 010…, so drop a leading zero.
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

revoke execute on function public.admin_search_users(text, user_role, approval_status, int, int, boolean) from public, anon;
grant  execute on function public.admin_search_users(text, user_role, approval_status, int, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The facts: + two-step sign-in, signed-in devices, the block
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_facts(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v          jsonb;
  v_sessions int;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if to_regclass('auth.sessions') is not null then
    execute 'select count(*)::int from auth.sessions where user_id = $1' into v_sessions using p_user;
  end if;

  select jsonb_build_object(
           'email_confirmed',       u.email_confirmed_at is not null,
           'last_sign_in_at',       u.last_sign_in_at,
           'auth_created_at',       u.created_at,
           'providers',             coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb),
           'sign_in_blocked_until', case when u.banned_until > now() then u.banned_until end,
           'verified_factors',      (select count(*) from auth.mfa_factors f
                                      where f.user_id = u.id and f.status = 'verified'),
           'sessions',              v_sessions
         )
    into v
    from auth.users u
   where u.id = p_user;

  return coalesce(v, '{}'::jsonb);
end;
$$;

revoke execute on function public.admin_user_facts(uuid) from public, anon;
grant  execute on function public.admin_user_facts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What the account has done
-- ---------------------------------------------------------------------------

create or replace function public.admin_user_activity(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with apps as (
    select a.status::text as s, count(*)::int as c
      from applications a
     where a.candidate_id = p_user
     group by a.status
  ),
  listings as (
    select j.status::text as s, count(*)::int as c
      from jobs j
     where j.company_id in (select m.company_id from company_members m where m.user_id = p_user)
     group by j.status
  ),
  filed as (
    select count(*)::int                                                      as total,
           count(*) filter (where r.status = 'dismissed')::int                as dismissed,
           count(*) filter (where r.abusive)::int                             as abusive,
           count(*) filter (where r.status in ('open', 'investigating'))::int as open
      from reports r
     where r.reporter_id = p_user
  ),
  appeals as (
    select count(*)::int                                     as total,
           count(*) filter (where ma.status = 'open')::int   as open
      from moderation_appeals ma
     where ma.appellant_id = p_user
  )
  select jsonb_build_object(
           'applications', jsonb_build_object(
             'total',     coalesce((select sum(c) from apps), 0),
             'by_status', coalesce((select jsonb_object_agg(s, c) from apps), '{}'::jsonb)),
           'listings', jsonb_build_object(
             'total',     coalesce((select sum(c) from listings), 0),
             'by_status', coalesce((select jsonb_object_agg(s, c) from listings), '{}'::jsonb)),
           'reports_filed', (select to_jsonb(f) from filed f),
           'appeals',       (select to_jsonb(ap) from appeals ap),
           'saved_jobs',    (select count(*) from saved_jobs sj where sj.candidate_id = p_user),
           'notes',         (select count(*) from moderation_notes n
                              where n.target_type = 'user' and n.target_id = p_user::text),
           -- Decisions on the account: not a contact looked up, which is on
           -- the record but decided nothing.
           'decisions',     (select count(*) from admin_audit_log l
                              where l.target_type = 'user' and l.target_id = p_user::text
                                and l.action <> 'user.contact_revealed')
         )
    into v;

  return v;
end;
$$;

revoke execute on function public.admin_user_activity(uuid) from public, anon;
grant  execute on function public.admin_user_activity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_role(
  p_user   uuid,
  p_role   user_role,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor   uuid;
  v_profile profiles%rowtype;
  v_reason  text;
begin
  v_actor := public.admin_begin();

  if p_user = v_actor then
    raise exception 'an admin cannot change their own role';
  end if;

  v_reason := public.admin_reason(p_reason, true, 500);

  -- Role moves take turns: two admins taking each other's role at the same
  -- moment would each see the other still an admin, and leave none. Behind
  -- this lock the second sees the first's move before deciding.
  perform pg_advisory_xact_lock(hashtext('profiles:role'));

  select * into v_profile from profiles where id = p_user for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_profile.role = p_role then
    raise exception 'no_change' using hint = format('The account is already %s.', p_role);
  end if;
  -- Only the moves that make or unmake an admin. A candidate does not become
  -- an employer by an admin's hand: that is a company, a profile and a
  -- directory card, which onboarding makes and this would not.
  if v_profile.role <> 'admin' and p_role <> 'admin' then
    raise exception 'invalid_transition'
      using hint = 'An admin can make an account an admin, or an admin a candidate or employer again.';
  end if;
  -- An account still waiting, or suspended, is not made an admin: approve or
  -- restore it first, on the record, rather than have a promotion lift a hold
  -- nobody meant to lift (and send the "approved" email the header rules out).
  if p_role = 'admin' and v_profile.approval_status <> 'approved' then
    raise exception 'invalid_transition' using hint = 'Approve the account first.';
  end if;
  -- An account whose sign-in is blocked is not made an admin: the block is
  -- lifted only on a non-admin (admin_set_sign_in_block), so promoting it
  -- would make an admin nobody could let back in. Allow sign-in first.
  if p_role = 'admin' and exists (
    select 1 from auth.users u where u.id = p_user and u.banned_until is not null and u.banned_until > now()
  ) then
    raise exception 'invalid_transition' using hint = 'Allow the account to sign in first.';
  end if;
  -- Never the last admin. The actor cannot act on themselves, so in sequence
  -- one is always left; this holds under the lock above when the actor was
  -- demoted meanwhile.
  if v_profile.role = 'admin' and not exists (
    select 1 from profiles p where p.role = 'admin' and p.id <> p_user
  ) then
    raise exception 'last_admin' using hint = 'The console would be left with no admin.';
  end if;

  update profiles set role = p_role where id = p_user;

  perform public.admin_audit(
    case when p_role = 'admin' then 'user.promoted' else 'user.demoted' end,
    'user', p_user::text, v_profile.full_name, v_reason,
    jsonb_build_object('from', v_profile.role, 'to', p_role));
end;
$$;

revoke execute on function public.admin_set_role(uuid, user_role, text) from public, anon;
grant  execute on function public.admin_set_role(uuid, user_role, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The door: sessions, and the block
-- ---------------------------------------------------------------------------

/*
  Every session the account has, ended. Internal: the two levers below call
  it after admin_begin() and their own checks. GoTrue keeps a session row per
  signed-in device, with its refresh tokens hanging off it; without the row a
  refresh is refused, and the client signs out. Both tables are GoTrue's own,
  named rather than declared, so a database without them — the test stub —
  ends nothing rather than failing to define this.
*/
create or replace function public.admin_end_sessions_of(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_ended int := 0;
begin
  if to_regclass('auth.refresh_tokens') is not null then
    begin
      execute 'update auth.refresh_tokens set revoked = true, updated_at = now() where user_id = $1 and not revoked'
        using p_user::text;
    exception when insufficient_privilege then
      -- The sessions going is what signs the devices out; the tokens follow them.
      null;
    end;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
    get diagnostics v_ended = row_count;
  end if;
  return v_ended;
end;
$$;

revoke execute on function public.admin_end_sessions_of(uuid) from public, anon, authenticated;

create or replace function public.admin_end_sessions(
  p_user   uuid,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   uuid;
  v_profile profiles%rowtype;
  v_reason  text;
  v_ended   int;
begin
  v_actor := public.admin_begin();

  if p_user = v_actor then
    raise exception 'an admin cannot end their own sessions';
  end if;

  v_reason := public.admin_reason(p_reason, true, 500);

  select * into v_profile from profiles where id = p_user for update;
  if not found then
    raise exception 'not_found';
  end if;

  v_ended := public.admin_end_sessions_of(p_user);

  perform public.admin_audit('user.sessions_ended', 'user', p_user::text, v_profile.full_name, v_reason,
                             jsonb_build_object('sessions_ended', v_ended));
  return v_ended;
end;
$$;

revoke execute on function public.admin_end_sessions(uuid, text) from public, anon;
grant  execute on function public.admin_end_sessions(uuid, text) to authenticated;

create or replace function public.admin_set_sign_in_block(
  p_user   uuid,
  p_block  boolean,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor   uuid;
  v_profile profiles%rowtype;
  v_reason  text;
  v_blocked boolean;
  v_ended   int := 0;
begin
  v_actor := public.admin_begin();

  if p_user = v_actor then
    raise exception 'an admin cannot block their own sign-in';
  end if;

  v_reason := public.admin_reason(p_reason, true, 500);

  -- An admin's door is not shut from here: take their admin role away first.
  select * into v_profile from profiles where id = p_user and role <> 'admin' for update;
  if not found then
    raise exception 'no such account, or it belongs to an admin';
  end if;

  select u.banned_until is not null and u.banned_until > now()
    into v_blocked
    from auth.users u
   where u.id = p_user;
  if v_blocked is null then
    raise exception 'not_found';
  end if;
  if v_blocked = p_block then
    raise exception 'no_change'
      using hint = case when p_block then 'Sign-in is already blocked.' else 'Sign-in is already allowed.' end;
  end if;

  update auth.users
     set banned_until = case when p_block then timestamptz '2999-12-31 00:00:00+00' else null end,
         updated_at   = now()
   where id = p_user;

  if p_block then
    v_ended := public.admin_end_sessions_of(p_user);
  end if;

  perform public.admin_audit(
    case when p_block then 'user.sign_in_blocked' else 'user.sign_in_unblocked' end,
    'user', p_user::text, v_profile.full_name, v_reason,
    jsonb_build_object('sessions_ended', v_ended));
  return v_ended;
end;
$$;

revoke execute on function public.admin_set_sign_in_block(uuid, boolean, text) from public, anon;
grant  execute on function public.admin_set_sign_in_block(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The role changes only through its lever
-- ---------------------------------------------------------------------------

/*
  profiles_admin_all (migration 4) lets an admin update any row, and the guard
  (migration 305) only keeps them off their own role and approval. So the rules
  admin_set_role holds — a reason, only the moves that make or unmake an admin,
  nothing for a blocked or unapproved account, never the last admin — held on
  the lever alone, and `update profiles set role = …` through PostgREST walked
  round every one of them (logged as a direct write, but done). Now a role
  changes under an admin's hand only inside the console's own transaction
  (app.admin_console, set by admin_begin). A connection with no claims — a
  migration, the seed, the service role — is trusted as before.
*/

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    if new.id = (select auth.uid())
       and (new.role, new.approval_status, new.approved_at)
           is distinct from
           (old.role, old.approval_status, old.approved_at)
    then
      raise exception 'an admin cannot change their own approval';
    end if;

    -- An admin's own token (is_admin reads auth.uid()), not the service role
    -- or a connection with no claims, which acting_as_admin also trusts.
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

  -- The account's own clock is not the account's to set.
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not user-writable';
  end if;

  return new;
end;
$$;
