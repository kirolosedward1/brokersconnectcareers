-- =============================================================================
-- 22 — A company was one person's login, permanently
--
-- companies.owner_id was the only link between a company and a human, and
-- owns_company() resolved through it — so every employer-side policy inherited
-- the restriction. Two ordinary consequences for the companies this sells to:
-- an HR team of three could not share one company's listings and applicants,
-- and when whoever signed up left, the company was stranded with no handover
-- that did not involve editing the database by hand.
--
-- The payoff for having routed all thirteen policies through one function is
-- collected here: owns_company() is redefined to mean "is a member of", and
-- every policy, including the four on storage, inherits it with no other edit.
-- Nothing below restates a policy, which is deliberate — migration 16 restated
-- guard_profile_update() and silently dropped a check that migration 08 had
-- added.
--
-- owner_id stays, and stays the anchor. Membership grants access; it does not
-- grant the company away. Billing, the one-company-per-owner index and
-- guard_company_update()'s refusal to transfer ownership are all unchanged.
-- =============================================================================

create type company_member_role as enum ('admin', 'recruiter');

create table company_members (
  company_id  uuid not null references companies on delete cascade,
  user_id     uuid not null references profiles  on delete cascade,
  -- 'recruiter' by default: the narrower of the two, so an invite that says
  -- nothing grants the less.
  role        company_member_role not null default 'recruiter',
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- "Which company am I in" is asked on every request through the employer
-- console; the primary key answers "who is in this company" already.
create index company_members_user_idx on company_members (user_id);

-- Every company that exists today keeps working, with its owner as its first
-- admin. Written before the functions change, so there is no instant in which
-- an existing employer is locked out of their own company.
insert into company_members (company_id, user_id, role)
select id, owner_id, 'admin' from companies
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The four functions that resolved through owner_id
-- ---------------------------------------------------------------------------

-- Kept under its old name. Thirteen policies and four storage rules reference
-- it, and renaming would mean restating all seventeen for no behavioural gain.
-- What it means has widened: any member, not only the owner.
create or replace function public.owns_company(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from company_members
     where company_id = target and user_id = auth.uid()
  );
$$;

-- The narrower one, for things a recruiter should not do: edit the company
-- record itself, and change who else is in it.
create or replace function public.is_company_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from company_members
     where company_id = target and user_id = auth.uid() and role = 'admin'
  );
$$;

revoke execute on function public.is_company_admin(uuid) from public;
grant  execute on function public.is_company_admin(uuid) to anon, authenticated, service_role;

-- Ordered, not arbitrary: a member of more than one company gets the one they
-- administer, and ties break on which they joined first.
create or replace function public.my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from company_members
   where user_id = auth.uid()
   order by (role = 'admin') desc, created_at asc
   limit 1;
$$;

create or replace function public.viewer_has_verified_company()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from company_members m
      join companies c on c.id = m.company_id
     where m.user_id = auth.uid() and c.verification_status = 'verified'
  );
$$;

create or replace function public.owns_job(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from jobs j
      join company_members m on m.company_id = j.company_id
     where j.id = target and m.user_id = auth.uid()
  );
$$;

-- The company record itself is an admin's to edit. This one policy did not go
-- through owns_company() — it compared owner_id directly — so it is the single
-- policy this migration restates, and it is restated in full.
drop policy if exists companies_update_own on companies;

create policy companies_update_own on companies
  for update using (public.is_company_admin(id))
  with check (public.is_company_admin(id));

-- ---------------------------------------------------------------------------
-- Who may see and change the roster
-- ---------------------------------------------------------------------------

alter table company_members enable row level security;

-- No recursion, despite reading the table these policies are on: both helpers
-- are SECURITY DEFINER and therefore run past RLS. That is what migration 07
-- hardened them for.
create policy company_members_select on company_members
  for select using (public.owns_company(company_id) or public.is_admin());

create policy company_members_manage on company_members
  for all using (public.is_company_admin(company_id) or public.is_admin())
  with check (public.is_company_admin(company_id) or public.is_admin());

create or replace function public.guard_company_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_role  user_role;
begin
  select owner_id into v_owner
    from companies where id = coalesce(new.company_id, old.company_id);

  -- The owner's own membership is not an admin's to revoke or demote. Without
  -- this, one admin could remove the person the company is registered to and
  -- leave billing pointing at somebody with no access.
  if tg_op = 'DELETE' and old.user_id = v_owner then
    raise exception 'company_owner_membership'
      using hint = 'The owner cannot be removed from their own company.';
  end if;

  if tg_op = 'UPDATE' and old.user_id = v_owner and new.role <> 'admin' then
    raise exception 'company_owner_membership'
      using hint = 'The owner is always an admin of their own company.';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select role into v_role from profiles where id = new.user_id;
    -- A consultant with employer powers would be able to read applications to
    -- their own listings, which is the exact hole migration 15 closed.
    if v_role = 'candidate' then
      raise exception 'company_member_role'
        using hint = 'Only an employer account can be added to a company.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger company_members_10_guard
  before insert or update or delete on company_members
  for each row execute function public.guard_company_membership();

-- ---------------------------------------------------------------------------
-- Whoever creates a company is its first admin
-- ---------------------------------------------------------------------------
--
-- The backfill above covers every company that already exists, and nothing
-- else. Without this, the next company created after this migration would have
-- no members at all — and since owns_company() now resolves through
-- membership, its own owner would be locked out of the company they had just
-- made. The policy suite found this immediately: its fixtures are seeded after
-- the migrations run, so every one of them arrived memberless and twenty-three
-- assertions failed at once.
--
-- SECURITY DEFINER because of the ordering: at the instant this runs, the
-- creator is not yet an admin of anything, so company_members_manage would
-- refuse the very row that makes them one.
create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into company_members (company_id, user_id, role)
  values (new.id, new.owner_id, 'admin')
  on conflict do nothing;
  return new;
end;
$$;

create trigger companies_20_add_owner_member
  after insert on companies
  for each row execute function public.add_owner_as_member();

grant select, insert, update, delete on company_members to authenticated;
grant select on company_members to anon;
