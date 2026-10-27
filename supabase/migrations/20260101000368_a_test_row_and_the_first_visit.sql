-- =============================================================================
-- 368 — A test row, and the first visit
--
-- Two marks an admin can see, and neither is a tracker.
--
-- is_test says a row is ours: a seed account, a QA company, the store-review
-- login. It is false for everyone else, and only the console can change it.
-- The first-visit columns are what the browser already knew on the first
-- page — a referrer host, a campaign name, the path — written once, when the
-- account is created or on the first signed-in session, and never replaced.
-- No click id is stored, and no address.
--
-- Opening an account or a company in the console shows the email and the
-- phone without a second click. That look is still a record: admin_view_contacts
-- writes user.contact_viewed, quietly, and refuses anyone who is not an admin.
-- The same hour does not write the same look again.
--
-- rollback: drop function public.admin_view_contacts(uuid[]), public.admin_set_test_flag(uuid, uuid, boolean, text), public.admin_search_users(text, user_role, approval_status, int, int, boolean, boolean, text), public.guard_new_test_flag(); drop trigger profiles_05_test_flag on profiles; drop trigger companies_05_test_flag on companies; drop policy if exists saved_jobs_admin_read on saved_jobs; drop policy if exists saved_searches_admin_read on saved_searches; then restate admin_search_users (6 arguments) and guard_profile_update() from migration 355, and guard_company_update() from migration 344, with their grants; alter table profiles drop constraint profiles_first_source, drop column is_test, drop column first_source, drop column first_medium, drop column first_campaign, drop column first_referrer, drop column first_landing_path, drop column first_seen_at; alter table companies drop column is_test;
-- safety: constraint, ships-with-code — is_test is not null with a constant
--   default, so every existing row is false until the backfill below marks the
--   known test rows, and the check on first_source allows null. The new search
--   arguments default to null, so the console and the app keep calling
--   admin_search_users with the arguments they already send. admin_view_contacts
--   is new: a database without it leaves the contact card empty and the rest of
--   the page up. Either order is a working console.
-- safety: rls — an admin may read saved jobs and saved searches, which the
--   account page lists; the owner policies stay, and nobody else gains a read.
-- =============================================================================

alter table profiles
  add column is_test boolean not null default false,
  add column first_source text,
  add column first_medium text,
  add column first_campaign text,
  add column first_referrer text,
  add column first_landing_path text,
  add column first_seen_at timestamptz,
  add constraint profiles_first_source check (
    first_source is null
    or first_source in (
      'direct', 'google', 'google_ads', 'facebook', 'instagram', 'tiktok',
      'linkedin', 'whatsapp', 'x', 'email', 'referral', 'other', 'app'
    )
  );

alter table companies
  add column is_test boolean not null default false;

comment on column profiles.is_test is
  'Ours: a seed, a QA login, or the store-review account. Set only from the console.';
comment on column profiles.first_source is
  'Where the first visit came from. Written once. Null means we do not know.';
comment on column profiles.first_seen_at is
  'When that first visit was. Null on every account that existed before it was recorded.';
comment on column companies.is_test is
  'Ours: a seed company, a QA company, or the store-review company. Set only from the console.';

-- ---------------------------------------------------------------------------
-- Nobody marks themselves as a test, and the first visit is written once
-- ---------------------------------------------------------------------------

create or replace function public.guard_new_test_flag()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- A signed-in insert cannot arrive already marked. The migration and the
  -- service role have no JWT, and the console sets its own marker.
  if new.is_test
     and nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(current_setting('app.admin_console', true), 'off') <> 'on' then
    new.is_test := false;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_new_test_flag() from public, anon, authenticated;

drop trigger if exists profiles_05_test_flag on profiles;
create trigger profiles_05_test_flag
  before insert on profiles
  for each row execute function public.guard_new_test_flag();

drop trigger if exists companies_05_test_flag on companies;
create trigger companies_05_test_flag
  before insert on companies
  for each row execute function public.guard_new_test_flag();

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- The mark is the console's. A migration has no JWT, so the backfill passes.
  if new.is_test is distinct from old.is_test
     and coalesce(current_setting('app.admin_console', true), 'off') <> 'on'
     and nullif(current_setting('request.jwt.claims', true), '') is not null then
    raise exception 'is_test is an admin action';
  end if;

  -- Fill the blanks once. A second write does not get to rewrite the first visit.
  if (new.first_source, new.first_medium, new.first_campaign, new.first_referrer, new.first_landing_path, new.first_seen_at)
     is distinct from
     (old.first_source, old.first_medium, old.first_campaign, old.first_referrer, old.first_landing_path, old.first_seen_at)
     and (old.first_source is not null or old.first_seen_at is not null) then
    raise exception 'the first visit is written once';
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

create or replace function public.guard_company_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.is_test is distinct from old.is_test
     and coalesce(current_setting('app.admin_console', true), 'off') <> 'on'
     and nullif(current_setting('request.jwt.claims', true), '') is not null then
    raise exception 'is_test is an admin action';
  end if;

  if public.acting_as_admin() then return new; end if;

  if new.slug is distinct from old.slug then
    raise exception 'a company slug is permanent — links and follows point at it';
  end if;

  if new.verification_status is distinct from old.verification_status then
    if not (
      coalesce(current_setting('app.submitting_for_review', true), 'off') = 'on'
      and new.verification_status = 'pending'
      and old.verification_status in ('unverified', 'rejected')
    ) then
      raise exception 'verification_status is set by review, not by the owner';
    end if;
  end if;

  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set by review, not by the owner';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'company ownership cannot be transferred';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is not owner-writable';
  end if;

  if new.post_credits is distinct from old.post_credits
     and coalesce(current_setting('app.granting_credits', true), 'off') <> 'on' then
    raise exception 'post_credits is set by billing, not by the owner';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The contact, shown, and recorded without a reason typed in front of it
-- ---------------------------------------------------------------------------

create or replace function public.admin_view_contacts(p_users uuid[])
returns table (
  user_id uuid,
  email text,
  whatsapp_phone text,
  email_confirmed boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid;
  v_id uuid;
begin
  v_actor := public.admin_begin();
  if p_users is null or cardinality(p_users) = 0 then
    return;
  end if;
  if cardinality(p_users) > 40 then
    raise exception 'invalid' using hint = 'At most forty accounts in one look.';
  end if;

  for v_id in select distinct x from unnest(p_users) as t(x)
  loop
    if not exists (select 1 from profiles where id = v_id) then
      continue;
    end if;
    -- One record of a look, not one per refresh of the same hour.
    if not exists (
      select 1 from admin_audit_log
       where actor_id = v_actor
         and action = 'user.contact_viewed'
         and target_id = v_id::text
         and created_at > now() - interval '1 hour'
    ) then
      perform public.admin_audit(
        'user.contact_viewed',
        'user',
        v_id::text,
        (select full_name from profiles where id = v_id),
        null,
        '{}'::jsonb,
        'console'
      );
    end if;
  end loop;

  return query
  select p.id,
         u.email::text,
         p.whatsapp_phone,
         (u.email_confirmed_at is not null)
    from profiles p
    left join auth.users u on u.id = p.id
   where p.id = any (p_users);
end;
$$;

revoke execute on function public.admin_view_contacts(uuid[]) from public, anon;
grant execute on function public.admin_view_contacts(uuid[]) to authenticated;

-- One account, or one company. The reason is optional: the mark is ours.
create or replace function public.admin_set_test_flag(
  p_user uuid,
  p_company uuid,
  p_test boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_label text;
begin
  perform public.admin_begin();
  v_reason := public.admin_reason(p_reason, false);
  if (p_user is null) = (p_company is null) then
    raise exception 'invalid' using hint = 'Name one account or one company.';
  end if;
  if p_test is null then
    raise exception 'invalid' using hint = 'Say whether the row is a test.';
  end if;

  if p_user is not null then
    select full_name into v_label from profiles where id = p_user for update;
    if not found then
      raise exception 'not_found' using hint = 'No such account.';
    end if;
    update profiles set is_test = p_test where id = p_user;
    perform public.admin_audit(
      'user.test_flag', 'user', p_user::text, v_label, v_reason,
      jsonb_build_object('is_test', p_test), 'console'
    );
  else
    select name_ar into v_label from companies where id = p_company for update;
    if not found then
      raise exception 'not_found' using hint = 'No such company.';
    end if;
    update companies set is_test = p_test where id = p_company;
    perform public.admin_audit(
      'company.test_flag', 'company', p_company::text, v_label, v_reason,
      jsonb_build_object('is_test', p_test), 'console'
    );
  end if;
end;
$$;

revoke execute on function public.admin_set_test_flag(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_test_flag(uuid, uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The accounts list learns the two new facts, and can filter on them.
-- The arguments it already had keep their places and their defaults.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_search_users(text, user_role, approval_status, int, int, boolean);

create or replace function public.admin_search_users(
  p_query   text default null,
  p_role    user_role default null,
  p_status  approval_status default null,
  p_limit   int default 25,
  p_offset  int default 0,
  p_blocked boolean default null,
  p_test    boolean default null,
  p_source  text default null
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
  last_sign_in_at  timestamptz,
  is_test          boolean,
  first_source     text
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
           u.last_sign_in_at,
           p.is_test,
           p.first_source
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
       and (p_test is null or p.is_test = p_test)
       and (
         p_source is null
         or (p_source = 'unknown' and p.first_source is null)
         or (
           p_source in (
             'direct', 'google', 'google_ads', 'facebook', 'instagram', 'tiktok',
             'linkedin', 'whatsapp', 'x', 'email', 'referral', 'other', 'app'
           )
           and p.first_source = p_source
         )
       )
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

revoke execute on function public.admin_search_users(text, user_role, approval_status, int, int, boolean, boolean, text) from public, anon;
grant execute on function public.admin_search_users(text, user_role, approval_status, int, int, boolean, boolean, text) to authenticated;

-- The account page lists what a candidate saved. Owners already can; admins could not.
drop policy if exists saved_jobs_admin_read on saved_jobs;
create policy saved_jobs_admin_read on saved_jobs
  for select using ((select public.is_admin()));

drop policy if exists saved_searches_admin_read on saved_searches;
create policy saved_searches_admin_read on saved_searches
  for select using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Which rows are ours. Emails and names we planted, and the companies they own.
-- ---------------------------------------------------------------------------

update profiles p
   set is_test = true
 where p.is_test = false
   and (
     exists (
       select 1 from auth.users u
        where u.id = p.id
          and (
            lower(u.email) in ('k4hosting@gmail.com', 'kirolosedward1@gmail.com', 'info@topsuite.net')
            or lower(u.email) like '%+test%'
            or lower(u.email) like '%qa%'
            or lower(u.email) like '%test%'
          )
     )
     or p.full_name in ('فريق مراجعة التطبيق', 'مراجع التطبيق')
   );

update companies c
   set is_test = true
 where c.is_test = false
   and (
     c.name_ar = 'حساب مراجعة التطبيق'
     or c.name_en = 'App Review account'
     or c.slug = 'brokers-connect-app-review'
     or c.name_ar ilike '%QA TEST%'
     or c.name_en ilike '%QA TEST%'
     or c.name_en ilike '%do not use%'
     or c.owner_id in (select id from profiles where is_test)
   );

update profiles p
   set is_test = true
 where p.is_test = false
   and (
     p.id in (select owner_id from companies where is_test)
     or p.id in (
       select m.user_id
         from company_members m
         join companies c on c.id = m.company_id
        where c.slug = 'brokers-connect-app-review'
     )
     or p.id in (
       select a.user_id from agent_profiles a where a.slug = 'app-review-consultant'
     )
   );
