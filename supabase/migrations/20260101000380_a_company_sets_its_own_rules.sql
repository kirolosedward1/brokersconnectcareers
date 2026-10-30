-- =============================================================================
-- 380 — A company sets its own rules
--
-- docs/design/v1.1/phase-b/05, without the two the review dropped (decided):
-- no company-internal publish approval (platform moderation is the only gate)
-- and no automatic sign-out. What a company may now ask of its own team:
--
--   approve_decline         a decline by a member who is not an admin waits
--                           for an admin. The database refuses the move with
--                           'decline_needs_approval'; the website writes the
--                           request; an admin's decision makes the move.
--   approve_pay_change      the same for a change to a live listing's pay
--                           ('pay_change_needs_approval'): the rest of the
--                           edit is saved, the pay waits.
--   spend_ceiling_month_egp what the company may spend in a Cairo month;
--                           startCheckout refuses past it. Who may spend at
--                           all is migration 376's switch, so the doc's
--                           approve_spend is not needed.
--   require_mfa             every member must have signed in with a second
--                           factor (aal2) to work the company: owns_company(),
--                           is_company_admin() and owns_job() answer false
--                           otherwise, so every policy built on them holds,
--                           on the website and in the app alike.
--   cv_admins_only          only admins open applicants' CVs
--                           (may_read_application_cv(), asked by /api/cv).
--
-- Tested in supabase/tests/company-rules.test.mjs.
--
-- rollback: drop trigger if exists applications_07_decline_approval on applications;
--           drop trigger if exists jobs_07_pay_approval on jobs;
--           drop trigger if exists company_policies_05_mfa on company_policies;
--           drop function if exists public.refuse_unapproved_decline(), public.refuse_unapproved_pay_change(),
--             public.guard_company_policies(), public.may_read_application_cv(uuid), public.company_mfa_ok(uuid),
--             public.company_rules(), public.company_policy(uuid, text);
--           restate owns_company() and is_company_admin() from migration 308, owns_job() from 349;
--           drop table if exists company_approval_requests, company_policies;
-- safety: additive — every rule is off until a company's admin turns it on; the restated
--         helpers answer exactly as before for a company without require_mfa.
-- safety: ships-with-code — every rule is off until the new action turns it on, and the restated
--   helpers answer exactly as before for a company with no rules, so old code meets no new refusal.
-- =============================================================================

create table if not exists company_policies (
  company_id              uuid primary key references companies(id) on delete cascade,
  approve_decline         boolean not null default false,
  approve_pay_change      boolean not null default false,
  spend_ceiling_month_egp int check (spend_ceiling_month_egp between 0 and 10000000),
  require_mfa             boolean not null default false,
  cv_admins_only          boolean not null default false,
  updated_at              timestamptz not null default now()
);

alter table company_policies enable row level security;
revoke all on company_policies from anon;
grant select, insert, update on company_policies to authenticated;

-- Every member reads the rules they work under — even one a rule shuts out
-- (require_mfa), so the app can say why: plain membership, not owns_company().
create policy company_policies_member_read on company_policies
  for select to authenticated
  using (exists (select 1 from company_members m where m.company_id = company_policies.company_id and m.user_id = (select auth.uid())));

create policy company_policies_admin_insert on company_policies
  for insert to authenticated
  with check (public.is_company_admin(company_id));

create policy company_policies_admin_update on company_policies
  for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));

-- Turning on require_mfa is done from a session that has itself proved a
-- second factor: an admin cannot lock the company out from under themselves.
create or replace function public.guard_company_policies()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if new.require_mfa
     and (tg_op = 'INSERT' or not old.require_mfa)
     and auth.uid() is not null
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'mfa_required_to_require'
      using hint = 'Sign in with your second factor before requiring one of the team.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_company_policies() from public, anon, authenticated;

drop trigger if exists company_policies_05_mfa on company_policies;
create trigger company_policies_05_mfa
  before insert or update on company_policies
  for each row execute function public.guard_company_policies();

-- One rule of one company, false when it has none.
create or replace function public.company_policy(p_company uuid, p_rule text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case p_rule
             when 'approve_decline' then approve_decline
             when 'approve_pay_change' then approve_pay_change
             when 'require_mfa' then require_mfa
             when 'cv_admins_only' then cv_admins_only
             else false
           end
      from company_policies where company_id = p_company
  ), false);
$$;

revoke execute on function public.company_policy(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- require_mfa, in the helpers every company policy is built on
-- ---------------------------------------------------------------------------

create or replace function public.company_mfa_ok(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.company_policy(p_company, 'require_mfa')
      or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke execute on function public.company_mfa_ok(uuid) from public, anon, authenticated;

create or replace function public.owns_company(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.in_good_standing() and public.company_mfa_ok(target) and exists (
    select 1 from company_members
     where company_id = target and user_id = auth.uid()
  );
$$;

create or replace function public.is_company_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.in_good_standing() and public.company_mfa_ok(target) and exists (
    select 1 from company_members
     where company_id = target and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.owns_job(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.in_good_standing() and exists (
    select 1 from jobs j
      join company_members m on m.company_id = j.company_id
      join companies c on c.id = j.company_id
     where j.id = target and m.user_id = auth.uid()
       and c.suspended_at is null
       and public.company_mfa_ok(j.company_id)
  );
$$;

-- What the app asks to say why it is shut out, and what it must enrol in.
create or replace function public.company_rules()
returns table (
  company_id uuid,
  approve_decline boolean,
  approve_pay_change boolean,
  spend_ceiling_month_egp int,
  require_mfa boolean,
  cv_admins_only boolean,
  mfa_satisfied boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.company_id,
         coalesce(p.approve_decline, false), coalesce(p.approve_pay_change, false), p.spend_ceiling_month_egp,
         coalesce(p.require_mfa, false), coalesce(p.cv_admins_only, false),
         public.company_mfa_ok(m.company_id)
    from company_members m
    left join company_policies p on p.company_id = m.company_id
   where m.user_id = auth.uid()
   order by (m.role = 'admin') desc, m.created_at asc
   limit 1;
$$;

revoke execute on function public.company_rules() from public, anon;
grant execute on function public.company_rules() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- cv_admins_only
-- ---------------------------------------------------------------------------

create or replace function public.may_read_application_cv(p_application uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from applications a join jobs j on j.id = a.job_id
     where a.id = p_application
       and (
         a.candidate_id = auth.uid()
         or (public.company_policy(j.company_id, 'cv_admins_only') and public.is_company_admin(j.company_id))
         or (not public.company_policy(j.company_id, 'cv_admins_only') and public.owns_job(j.id))
       )
  );
$$;

revoke execute on function public.may_read_application_cv(uuid) from public, anon;
grant execute on function public.may_read_application_cv(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What waits for an admin
-- ---------------------------------------------------------------------------

create table if not exists company_approval_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  kind         text not null check (kind in ('decline', 'pay_change')),
  -- The application declined, or the listing whose pay changes.
  subject_id   uuid not null,
  -- What would happen if approved: the stage the card showed and the reason
  -- (a decline), or the new pay (a pay change). Small, never a row dump.
  payload      jsonb not null default '{}'::jsonb
               check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2048),
  requested_by uuid references profiles(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'refused', 'expired')),
  decided_by   uuid references profiles(id) on delete set null,
  decided_at   timestamptz,
  note         text check (length(note) <= 500),
  created_at   timestamptz not null default now()
);

create index if not exists company_approval_requests_queue_idx on company_approval_requests (company_id, status, created_at desc);
create index if not exists company_approval_requests_requested_by_idx on company_approval_requests (requested_by);
create index if not exists company_approval_requests_decided_by_idx on company_approval_requests (decided_by);
-- One open request per thing: a second decline of the same applicant is the same request.
create unique index if not exists company_approval_requests_one_open
  on company_approval_requests (kind, subject_id) where status = 'pending';

alter table company_approval_requests enable row level security;
revoke all on company_approval_requests from anon;
grant select, insert, update on company_approval_requests to authenticated;

create policy company_approval_requests_read on company_approval_requests
  for select to authenticated
  using (requested_by = (select auth.uid()) or public.is_company_admin(company_id));

create policy company_approval_requests_ask on company_approval_requests
  for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'pending' and public.owns_company(company_id));

create policy company_approval_requests_decide on company_approval_requests
  for update to authenticated
  using (public.is_company_admin(company_id) and status = 'pending')
  with check (public.is_company_admin(company_id) and status in ('approved', 'refused', 'expired') and decided_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- The refusals
-- ---------------------------------------------------------------------------

create or replace function public.refuse_unapproved_decline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
begin
  if new.status <> 'rejected' or old.status = 'rejected' or auth.uid() is null or public.acting_as_admin() then
    return new;
  end if;
  select company_id into v_company from jobs where id = new.job_id;
  if public.company_policy(v_company, 'approve_decline')
     and exists (select 1 from company_members where company_id = v_company and user_id = auth.uid() and role <> 'admin') then
    raise exception 'decline_needs_approval'
      using hint = 'The company asks an admin to approve a decline.';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_unapproved_decline() from public, anon, authenticated;

drop trigger if exists applications_07_decline_approval on applications;
create trigger applications_07_decline_approval
  before update of status on applications
  for each row execute function public.refuse_unapproved_decline();

create or replace function public.refuse_unapproved_pay_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'active' or auth.uid() is null or public.acting_as_admin() then
    return new;
  end if;
  if (new.basic_salary_min, new.basic_salary_max, new.commission_type, new.commission_value, new.commission_note_ar)
     is not distinct from (old.basic_salary_min, old.basic_salary_max, old.commission_type, old.commission_value, old.commission_note_ar) then
    return new;
  end if;
  if public.company_policy(new.company_id, 'approve_pay_change')
     and exists (select 1 from company_members where company_id = new.company_id and user_id = auth.uid() and role <> 'admin') then
    raise exception 'pay_change_needs_approval'
      using hint = 'The company asks an admin to approve a change to a live listing''s pay.';
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_unapproved_pay_change() from public, anon, authenticated;

drop trigger if exists jobs_07_pay_approval on jobs;
create trigger jobs_07_pay_approval
  before update on jobs
  for each row execute function public.refuse_unapproved_pay_change();
