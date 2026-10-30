-- =============================================================================
-- 378 — A company says when it hires
--
-- docs/design/v1.1/phase-b/07, part 7a. A company had no way to say "not now"
-- short of closing every listing, and no way to say how to reach it or when
-- it answers. Three things, on the company row, which is public by design
-- (the directory policy is `using (true)`, migration 367):
--
--   hiring_status   'open' or 'paused'. A paused company takes no new
--                   applications; its listings stay up and say so.
--   paused_until    the Cairo day it opens again by itself, or null for
--                   "until we say". Nothing has to run on that day: the
--                   check below reads it.
--   contact_whatsapp a number for candidates, shown on the company page
--                   only when set.
--   reply_hours     when the company answers: {"days":[0..6], "from":"HH:MM",
--                   "to":"HH:MM"}, Cairo time, 0 being Sunday.
--
-- The refusal is a trigger on applications, so every door (the website's
-- action, the API) is refused alike, with the message 'company_paused'.
--
-- Tested in supabase/tests/company-hiring.test.mjs.
--
-- rollback: drop trigger if exists applications_06_company_hiring on applications;
--           drop function if exists public.refuse_application_while_paused(), public.company_is_hiring(uuid);
--           alter table companies drop constraint companies_reply_hours_shape, drop constraint companies_contact_whatsapp_e164,
--             drop column hiring_status, drop column paused_until, drop column contact_whatsapp, drop column reply_hours;
-- safety: additive — every company starts open, with no number and no hours.
-- safety: ships-with-code — every company starts open, and only the new action pauses one, so the
--   new refusal on applications cannot meet code that does not know it.
-- safety: constraint — both checks are on columns this file adds, null on every row.
-- safety: grant, revoke-anon — company_is_hiring() is for anyone who reads a listing, signed out
--   included: a boolean read off columns the public company row already shows.
-- =============================================================================

alter table companies
  add column if not exists hiring_status    text not null default 'open' check (hiring_status in ('open', 'paused')),
  add column if not exists paused_until     date,
  add column if not exists contact_whatsapp text,
  add column if not exists reply_hours      jsonb;

alter table companies
  add constraint companies_contact_whatsapp_e164
    check (contact_whatsapp is null or contact_whatsapp ~ '^\+[1-9]\d{7,14}$');

-- Days a list of 0 to 6, the times HH:MM on the 24-hour clock, from before to.
alter table companies
  add constraint companies_reply_hours_shape check (
    reply_hours is null or (
      jsonb_typeof(reply_hours) = 'object'
      and jsonb_typeof(reply_hours -> 'days') = 'array'
      and jsonb_array_length(reply_hours -> 'days') between 1 and 7
      and (reply_hours ->> 'from') ~ '^([01]\d|2[0-3]):[0-5]\d$'
      and (reply_hours ->> 'to') ~ '^([01]\d|2[0-3]):[0-5]\d$'
      and (reply_hours ->> 'from') < (reply_hours ->> 'to')
      and pg_column_size(reply_hours) <= 256
    )
  );

comment on column companies.hiring_status is
  'open or paused. A paused company takes no new applications (applications_06_company_hiring) until paused_until has passed, or until it opens again.';
comment on column companies.reply_hours is
  'When the company answers, Cairo time: {"days":[0..6] (0 = Sunday), "from":"HH:MM", "to":"HH:MM"}.';

-- Whether a company takes applications today. A pause that named a day ends
-- once that day has passed in Cairo.
create or replace function public.company_is_hiring(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.hiring_status = 'open'
        or (c.paused_until is not null and c.paused_until < (now() at time zone 'Africa/Cairo')::date)
      from companies c
     where c.id = p_company
  ), true);
$$;

revoke execute on function public.company_is_hiring(uuid) from public;
grant execute on function public.company_is_hiring(uuid) to anon, authenticated, service_role;

create or replace function public.refuse_application_while_paused()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from jobs where id = new.job_id;
  if not public.company_is_hiring(v_company) then
    raise exception 'company_paused'
      using hint = 'The company has paused hiring; its listings take no new applications until it opens again.';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_application_while_paused() from public, anon, authenticated;

drop trigger if exists applications_06_company_hiring on applications;
create trigger applications_06_company_hiring
  before insert on applications
  for each row execute function public.refuse_application_while_paused();
