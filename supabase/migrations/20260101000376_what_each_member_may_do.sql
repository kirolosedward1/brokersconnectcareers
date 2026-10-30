-- =============================================================================
-- 376 — What each member may do
--
-- Members were admins or recruiters, nothing finer
-- (docs/design/v1.1/phase-b/03). A company now switches, member by member,
-- three things (decided: switches, not more role names):
--
--   can_post    write and submit listings
--   can_reveal  reveal a consultant's number
--   can_spend   buy on the website
--
-- The owner may always do all three, whatever is stored. Defaults keep what
-- every member could do before: post and reveal on, spend on for admins.
-- The website's actions check post and spend; the database checks reveal,
-- in reveal_agent_contact() itself (restated from migration 304 with that
-- one check added), so no door around the action skips it.
--
-- How many numbers a company may reveal in a month depends on its plan
-- (decided); that waits for the plan definitions. The hourly and daily limits
-- stay as they are.
--
-- Tested in supabase/tests/member-permissions.test.mjs.
--
-- rollback: restate reveal_agent_contact() from migration 304;
--           drop function if exists public.member_can(uuid, text);
--           alter table company_members drop column can_post, drop column can_reveal, drop column can_spend;
-- safety: additive — defaults keep every member's powers as they were.
-- =============================================================================

alter table company_members
  add column if not exists can_post   boolean not null default true,
  add column if not exists can_reveal boolean not null default true,
  add column if not exists can_spend  boolean not null default false;

-- Admins could buy before; they still can.
update company_members set can_spend = true where role = 'admin';

create or replace function public.member_can(p_company uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- The company is given, never found by ownership (policies.test.mjs, "one
  -- source of truth"): this only asks whether the caller is its owner.
  select coalesce(
    (select true from companies c where c.id = p_company and auth.uid() = c.owner_id),
    (select case p_permission
              when 'post' then m.can_post
              when 'reveal' then m.can_reveal
              when 'spend' then m.can_spend
              else false
            end
       from company_members m
      where m.company_id = p_company and m.user_id = auth.uid()),
    false
  );
$$;

revoke execute on function public.member_can(uuid, text) from public, anon;
grant execute on function public.member_can(uuid, text) to authenticated, service_role;

create or replace function public.reveal_agent_contact(p_handle text)
returns table (
  status              text,
  retry_after_seconds int,
  full_name           text,
  whatsapp_phone      text,
  cv_path             text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_company   uuid;
  v_agent     agent_profiles%rowtype;
  v_person    profiles%rowtype;
  v_is_owner  boolean;
  v_is_admin  boolean;
  v_hour      record;
  v_day       record;
  v_cday      record;
  v_seen      boolean;
  v_hour_n    int;
  v_day_n     int;
  v_cday_n    int;
begin
  if v_uid is null then
    return query select 'unauthenticated', null::int, null::text, null::text, null::text;
    return;
  end if;

  select a.* into v_agent
    from agent_profiles a
   where a.slug = p_handle
      or (p_handle ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and a.id = p_handle::uuid);

  if v_agent.id is null then
    return query select 'not_found', null::int, null::text, null::text, null::text;
    return;
  end if;

  v_is_owner := v_agent.user_id = v_uid;
  v_is_admin := public.is_admin();
  v_company  := public.my_company_id();

  if not v_is_owner and not v_is_admin
     and (v_company is null or not public.is_approved_employer()) then
    return query select 'forbidden', null::int, null::text, null::text, null::text;
    return;
  end if;

  -- The member's own switch (migration 376): a company may keep a member from
  -- revealing numbers; the owner always may.
  if not v_is_owner and not v_is_admin and not public.member_can(v_company, 'reveal') then
    return query select 'not_permitted', null::int, null::text, null::text, null::text;
    return;
  end if;

  if not public.agent_card_open_to_viewer(v_agent.id) then
    return query select 'locked', null::int, null::text, null::text, null::text;
    return;
  end if;

  select p.* into v_person from profiles p where p.id = v_agent.user_id;

  -- The owner's own number and an admin's review are not what the limits are
  -- for, and neither is written to the ledger.
  if v_is_owner or v_is_admin then
    return query select 'ok', null::int, v_person.full_name, v_person.whatsapp_phone, v_agent.cv_path;
    return;
  end if;

  -- One reveal per viewer per consultant per day, however many times the page
  -- is opened. Counted before the lock so a repeat costs one index read.
  select exists (
    select 1 from agent_contact_reveals r
     where r.viewer_id = v_uid and r.agent_id = v_agent.id
       and r.created_at > now() - interval '1 day'
  ) into v_seen;

  if v_seen then
    return query select 'ok', null::int, v_person.full_name, v_person.whatsapp_phone, v_agent.cv_path;
    return;
  end if;

  -- Serialise this viewer's reveals, so twenty parallel requests cannot each
  -- see a count of nineteen.
  perform pg_advisory_xact_lock(hashtext('contact_reveal:' || v_uid::text));

  select * into v_hour from public.limit_for('contact_reveal:user:hour',   3600,  30);
  select * into v_day  from public.limit_for('contact_reveal:user:day',    86400, 120);
  select * into v_cday from public.limit_for('contact_reveal:company:day', 86400, 300);

  select count(*) into v_hour_n from agent_contact_reveals r
   where r.viewer_id = v_uid and r.created_at > now() - make_interval(secs => v_hour.window_seconds);
  select count(*) into v_day_n from agent_contact_reveals r
   where r.viewer_id = v_uid and r.created_at > now() - make_interval(secs => v_day.window_seconds);
  select count(*) into v_cday_n from agent_contact_reveals r
   where r.company_id = v_company and r.created_at > now() - make_interval(secs => v_cday.window_seconds);

  if v_hour_n >= v_hour.max_hits or v_day_n >= v_day.max_hits or v_cday_n >= v_cday.max_hits then
    perform public.record_security_event(
      'contact.reveal_rate_limited',
      case when v_day_n >= v_day.max_hits or v_cday_n >= v_cday.max_hits then 'warning' else 'info' end,
      null,
      jsonb_build_object('company_id', v_company, 'hour', v_hour_n, 'day', v_day_n, 'company_day', v_cday_n),
      v_uid
    );
    return query select
      'rate_limited',
      case when v_hour_n >= v_hour.max_hits then v_hour.window_seconds else v_day.window_seconds end,
      null::text, null::text, null::text;
    return;
  end if;

  insert into agent_contact_reveals (agent_id, viewer_id, company_id)
  values (v_agent.id, v_uid, v_company);

  return query select 'ok', null::int, v_person.full_name, v_person.whatsapp_phone, v_agent.cv_path;
end;
$$;

revoke execute on function public.reveal_agent_contact(text) from public, anon;
grant  execute on function public.reveal_agent_contact(text) to authenticated, service_role;
