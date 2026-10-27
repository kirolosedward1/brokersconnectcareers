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
-- The platform trend covered thirty days. The console now offers seven, thirty
-- and ninety, each compared with the period before it, so the function returns
-- one hundred and eighty days. A chart that still plots whatever it is given
-- keeps working.
--
-- The test mark and the first visit already landed in migration 368
-- (is_test, admin_set_test_flag, first_source, admin_search_users). This file
-- does not add a second column or a second function for them.
--
-- Compatibility: the website allows an empty reason before this lands, and the
-- database still answers reason_required until it does — the action shows that
-- sentence and changes nothing. After this lands and before the new website,
-- a blank reason is stored as null and the trend simply has more points.
-- Neither order takes the console down.
--
-- rollback: create or replace function public.admin_reason(p_reason text, p_required boolean, p_max int default 500) returns text language plpgsql immutable set search_path = public, pg_temp as $$ declare v text := nullif(btrim(p_reason), ''); begin if p_required and (v is null or length(v) < 3) then raise exception 'reason_required' using hint = 'This action needs a reason of at least three characters.'; end if; if length(v) > p_max then raise exception 'reason_too_long' using hint = format('Keep the reason under %s characters.', p_max); end if; return v; end; $$; alter table reporting_restrictions drop constraint reporting_restrictions_reason_check; update reporting_restrictions set reason = 'بدون سبب' where reason is null or length(btrim(reason)) < 3; alter table reporting_restrictions alter column reason set not null; alter table reporting_restrictions add constraint reporting_restrictions_reason_check check (length(btrim(reason)) between 3 and 500); then restate admin_trend() from migration 362.
-- safety: constraint, ships-with-code — the new check allows null and refuses only a reason longer than 500, and no existing row is longer than that. Code that still requires three characters keeps working against this database (it never sends a blank). Code that sends a blank before this migration is applied gets reason_required back and shows it, and changes nothing. The chart plots however many days admin_trend returns, so thirty days still draw and one hundred and eighty still draw. Either order leaves the console up.
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
