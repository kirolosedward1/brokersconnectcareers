-- =============================================================================
-- 317 — One approval lever after the note moved
--
-- Two migrations restate set_account_approval, and neither knew the other.
--
--   305 moved the reviewer's note off profiles into profile_private, where only
--       an admin can read it, and dropped the column.
--   316 (the operations console, live on production since 2026-09-27) made the
--       function the console's lever: a row lock, a refusal to repeat a
--       decision, a validated reason, and an audit record in the same
--       transaction as the change.
--
-- Whichever runs second throws away the other's half. 305 last, and the
-- console's suspensions stop being recorded. 316 last, and the function writes
-- a column that no longer exists, so every approval fails. admin_search_users
-- (316) has the same problem in a smaller form: it still reads the dropped
-- column.
--
-- This migration keeps both halves. set_account_approval is 316's lever, and it
-- writes the note to profile_private before the profile row changes, because
-- the approval notification trigger reads it there (305).
-- admin_search_users reads the note from the same place. Signatures and grants
-- are unchanged, so the console calls them exactly as before.
--
-- Order: production ran 316 before any of 300–313, so there this must be applied
-- after 305. On a fresh database it sorts after both.
-- =============================================================================

-- rollback: forward-fix only — the bodies this replaces are 305's and 316's, and each of them alone is broken against the other's schema.
-- safety: ships-with-code — the console calls both functions with the same arguments and reads the same columns before and after this, so the code and this migration can reach production in either order.

create or replace function public.set_account_approval(
  p_user   uuid,
  p_status approval_status,
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile profiles%rowtype;
  v_note    text;
  v_down    int := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_user = auth.uid() then
    raise exception 'an admin cannot change their own approval';
  end if;

  perform set_config('app.admin_console', 'on', true);

  select * into v_profile from profiles where id = p_user and role <> 'admin' for update;
  if not found then
    raise exception 'no such account, or it belongs to an admin';
  end if;

  if v_profile.approval_status = p_status then
    raise exception 'no_change' using hint = format('The account is already %s.', p_status);
  end if;

  -- At most 500 characters, the same cap profile_private enforces, so a long
  -- note is refused as 'reason_too_long' rather than as a constraint name.
  v_note := public.admin_reason(p_note, p_status = 'rejected', 500);

  -- The note first: the notification trigger on profiles reads it, and it
  -- fires as part of the UPDATE below.
  insert into profile_private (user_id, approval_note, updated_at)
  values (p_user, v_note, now())
  on conflict (user_id) do update
    set approval_note = excluded.approval_note,
        updated_at    = now();

  update profiles
     set approval_status = p_status,
         approved_at     = case when p_status = 'approved' then now() else null end
   where id = p_user;

  if p_status = 'rejected' then
    /*
      The profile above is already suspended by the time this runs, so the
      "is anybody else still approved" test does not need to exclude the target
      by status — but it does exclude them by id, because a company whose only
      member has just been suspended must not count that member as cover for
      itself.
    */
    update jobs
       set status = 'rejected',
           rejection_note = coalesce(v_note, 'الحساب موقوف')
     where status in ('active', 'pending_review')
       and company_id in (
         select cm.company_id
           from company_members cm
          where cm.user_id = p_user
            and not exists (
              select 1
                from company_members peer
                join profiles p on p.id = peer.user_id
               where peer.company_id = cm.company_id
                 and peer.user_id <> p_user
                 and p.approval_status = 'approved'
            )
       );
    get diagnostics v_down = row_count;
  end if;

  perform public.admin_audit(
    case
      when p_status = 'rejected' then 'user.suspended'
      when p_status = 'pending'  then 'user.held'
      when v_profile.approval_status = 'rejected' then 'user.restored'
      else 'user.approved'
    end,
    'user', p_user::text, v_profile.full_name, v_note,
    jsonb_build_object('from', v_profile.approval_status, 'to', p_status,
                       'role', v_profile.role, 'listings_taken_down', v_down));
end;
$$;

create or replace function public.admin_search_users(
  p_query  text default null,
  p_role   user_role default null,
  p_status approval_status default null,
  p_limit  int default 25,
  p_offset int default 0
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
  total_count      bigint
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
           count(*) over ()
      from profiles p
      left join profile_private pp on pp.user_id = p.id
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
       and (
         v_q is null
         or (v_uuid is not null and p.id = v_uuid)
         or (v_email is not null and p.id = v_email)
         or (v_digits is not null and p.whatsapp_phone like '%' || v_digits || '%')
         or p.full_name ilike public.admin_like_pattern(v_q)
       )
     order by (p.approval_status = 'pending') desc, p.created_at desc, p.id desc
     limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
end;
$$;

-- Stated outright rather than inherited, so the result does not depend on
-- which of 305 and 316 ran last. Supabase grants anon EXECUTE at creation;
-- `from public` alone would leave that grant in place.
revoke execute on function public.set_account_approval(uuid, approval_status, text) from public, anon;
grant execute on function public.set_account_approval(uuid, approval_status, text) to authenticated, service_role;

revoke execute on function public.admin_search_users(text, user_role, approval_status, int, int) from public, anon;
grant execute on function public.admin_search_users(text, user_role, approval_status, int, int) to authenticated;
