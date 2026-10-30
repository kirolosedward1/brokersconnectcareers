-- =============================================================================
-- 383 — A company in more than one place
--
-- docs/design/v1.1/phase-b/07, part 7b. A company had one district
-- (companies.district_id, kept as the head office); the OnbCompany boards
-- name several. A company now lists its branches, each with a name and a
-- district, and a listing may say which branch it is for.
--
--   company_branches   at most twenty per company; read by everyone (the
--                      company page shows them), written by its admins.
--   jobs.branch_id     a branch of the listing's own company, or nothing;
--                      a branch removed leaves its listings without one.
--
-- Tested in supabase/tests/company-branches.test.mjs.
--
-- rollback: drop trigger if exists jobs_08_branch_of_company on jobs;
--           drop trigger if exists company_branches_05_cap on company_branches;
--           drop function if exists public.guard_job_branch(), public.guard_branch_cap();
--           alter table jobs drop column branch_id;
--           drop table if exists company_branches;
-- safety: additive — a new table and a nullable column; nothing changes until a company adds a branch.
-- safety: ships-with-code — the column is new and nullable, and saveJob writes it only when the form
--   sends one, so the website's form (which sends none) leaves it as it is in either order.
-- safety: grant — branches are a company's public facts, shown on its page: a name and a district,
--   nothing about a person; writing them stays with the company's admins.
-- =============================================================================

create table if not exists company_branches (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  name_ar     text not null check (char_length(btrim(name_ar)) between 1 and 80),
  name_en     text check (name_en is null or char_length(btrim(name_en)) between 1 and 80),
  district_id int references districts(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists company_branches_company_idx on company_branches (company_id, created_at);
create index if not exists company_branches_district_idx on company_branches (district_id);

alter table company_branches enable row level security;
revoke all on company_branches from anon, authenticated;
grant select on company_branches to anon, authenticated;
grant insert, update, delete on company_branches to authenticated;

create policy company_branches_read on company_branches
  for select using (true);

create policy company_branches_admin_insert on company_branches
  for insert to authenticated with check (public.is_company_admin(company_id));

create policy company_branches_admin_update on company_branches
  for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));

create policy company_branches_admin_delete on company_branches
  for delete to authenticated using (public.is_company_admin(company_id));

-- Twenty at most: a branch list, not a directory.
create or replace function public.guard_branch_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from companies where id = new.company_id for update;
  if (select count(*) from company_branches where company_id = new.company_id) >= 20 then
    raise exception 'branch_cap'
      using hint = 'A company lists twenty branches at most.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_branch_cap() from public, anon, authenticated;

drop trigger if exists company_branches_05_cap on company_branches;
create trigger company_branches_05_cap
  before insert on company_branches
  for each row execute function public.guard_branch_cap();

alter table jobs add column if not exists branch_id bigint references company_branches(id) on delete set null;
create index if not exists jobs_branch_idx on jobs (branch_id);

-- A listing names a branch of its own company only.
create or replace function public.guard_job_branch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.branch_id is not null
     and not exists (select 1 from company_branches where id = new.branch_id and company_id = new.company_id) then
    raise exception 'branch_not_of_company'
      using hint = 'A listing names a branch of its own company.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_job_branch() from public, anon, authenticated;

drop trigger if exists jobs_08_branch_of_company on jobs;
create trigger jobs_08_branch_of_company
  before insert or update of branch_id, company_id on jobs
  for each row execute function public.guard_job_branch();
