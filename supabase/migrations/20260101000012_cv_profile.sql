-- =============================================================================
-- 12 — The consultant profile becomes a CV
--
-- Until now a profile was a headline, a number of years, some tracks and some
-- districts: a search filter, not a document anybody would hire from. This
-- adds the parts of a real record — what they have sold, where they have
-- worked, what they studied, what they are certified in.
--
-- Everything here is optional. An existing profile stays valid and complete;
-- nothing that works today starts failing because a new section exists.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The record, on the profile itself.
--
-- In this market a CV leads with volume closed, not with job titles. Two
-- numbers and a paragraph carry more than another list would.
-- ---------------------------------------------------------------------------

alter table agent_profiles
  add column summary_ar   text check (length(summary_ar) <= 1200),
  add column summary_en   text check (length(summary_en) <= 1200),
  add column units_closed int   check (units_closed >= 0 and units_closed <= 100000),
  add column volume_egp   bigint check (volume_egp >= 0);

comment on column agent_profiles.summary_ar is
  'The objective — a short paragraph in the consultant''s own words.';
comment on column agent_profiles.volume_egp is
  'Total closed value in EGP. Self-reported; the platform does not verify it.';

-- ---------------------------------------------------------------------------
-- Work history.
--
-- `ended is null` means current. A separate is_current flag would be a second
-- source of truth that can disagree with the dates, and eventually will.
-- ---------------------------------------------------------------------------

create table agent_experience (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references agent_profiles on delete cascade,
  company_name text not null check (length(btrim(company_name)) between 1 and 120),
  title        text not null check (length(btrim(title)) between 1 and 120),
  track        job_track,
  district_id  int references districts,
  started      date not null,
  ended        date,
  highlights   text check (length(highlights) <= 600),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),

  constraint agent_experience_dates check (ended is null or ended >= started)
);

create index agent_experience_agent_idx on agent_experience (agent_id, started desc);

create table agent_education (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agent_profiles on delete cascade,
  institution text not null check (length(btrim(institution)) between 1 and 160),
  degree      text check (length(degree) <= 120),
  field       text check (length(field) <= 120),
  graduated   int check (graduated between 1950 and 2100),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index agent_education_agent_idx on agent_education (agent_id, graduated desc);

create table agent_certifications (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references agent_profiles on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 160),
  issuer     text check (length(issuer) <= 160),
  issued     date,
  expires    date,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),

  constraint agent_certifications_dates check (expires is null or issued is null or expires >= issued)
);

create index agent_certifications_agent_idx on agent_certifications (agent_id, issued desc);

-- ---------------------------------------------------------------------------
-- Caps, in the database.
--
-- A CV with sixty jobs on it is not a CV, and an unbounded child table is a
-- way to make somebody else's profile page take a second to render.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_cv_section_cap()
returns trigger
language plpgsql
as $$
declare
  v_count int;
  v_cap   int := tg_argv[0]::int;
begin
  execute format('select count(*) from %I where agent_id = $1', tg_table_name)
    into v_count using new.agent_id;

  if v_count >= v_cap then
    raise exception 'cv_section_cap'
      using hint = format('At most %s entries in %s.', v_cap, tg_table_name);
  end if;

  return new;
end;
$$;

create trigger agent_experience_cap before insert on agent_experience
  for each row execute function public.enforce_cv_section_cap('25');
create trigger agent_education_cap before insert on agent_education
  for each row execute function public.enforce_cv_section_cap('10');
create trigger agent_certifications_cap before insert on agent_certifications
  for each row execute function public.enforce_cv_section_cap('20');

-- ---------------------------------------------------------------------------
-- The gate, inherited.
--
-- This is the trap the whole feature turns on. A consultant hiding from their
-- current employer has a row here *naming that employer* — the single most
-- identifying field on the page. So visibility is not decided by the page
-- choosing what to render; each row is only visible if the profile it belongs
-- to is, and RLS on agent_profiles decides that inside the subquery.
--
-- Same shape as agent_developers, which already works this way.
-- ---------------------------------------------------------------------------

alter table agent_experience     enable row level security;
alter table agent_education      enable row level security;
alter table agent_certifications enable row level security;

create policy agent_experience_select on agent_experience
  for select using (exists (select 1 from agent_profiles a where a.id = agent_id));

create policy agent_experience_write on agent_experience
  for all using (
    exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = auth.uid())
  ) with check (
    exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = auth.uid())
  );

create policy agent_education_select on agent_education
  for select using (exists (select 1 from agent_profiles a where a.id = agent_id));

create policy agent_education_write on agent_education
  for all using (
    exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = auth.uid())
  ) with check (
    exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = auth.uid())
  );

create policy agent_certifications_select on agent_certifications
  for select using (exists (select 1 from agent_profiles a where a.id = agent_id));

create policy agent_certifications_write on agent_certifications
  for all using (
    exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = auth.uid())
  ) with check (
    exists (select 1 from agent_profiles a where a.id = agent_id and a.user_id = auth.uid())
  );

create policy agent_experience_admin on agent_experience
  for all using (public.is_admin()) with check (public.is_admin());
create policy agent_education_admin on agent_education
  for all using (public.is_admin()) with check (public.is_admin());
create policy agent_certifications_admin on agent_certifications
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Completeness.
--
-- Weighted by what actually helps an employer decide, not by how many columns
-- are populated. The dashboard wants this too, which is why it lives here
-- rather than being recomputed in two places.
-- ---------------------------------------------------------------------------

create or replace function public.profile_completeness(p_agent_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select least(100, coalesce(sum(points), 0))::int
  from (
    select case when a.headline_ar is not null and btrim(a.headline_ar) <> '' then 15 else 0 end as points
      from agent_profiles a where a.id = p_agent_id
    union all
    select case when a.summary_ar is not null and btrim(a.summary_ar) <> '' then 20 else 0 end
      from agent_profiles a where a.id = p_agent_id
    union all
    select case when a.years_experience > 0 then 10 else 0 end
      from agent_profiles a where a.id = p_agent_id
    union all
    select case when array_length(a.tracks, 1) > 0 then 10 else 0 end
      from agent_profiles a where a.id = p_agent_id
    union all
    select case when array_length(a.district_ids, 1) > 0 then 10 else 0 end
      from agent_profiles a where a.id = p_agent_id
    union all
    select case when a.units_closed is not null or a.volume_egp is not null then 10 else 0 end
      from agent_profiles a where a.id = p_agent_id
    union all
    select case when exists (select 1 from agent_experience e where e.agent_id = p_agent_id) then 15 else 0 end
    union all
    select case when exists (select 1 from agent_education d where d.agent_id = p_agent_id) then 10 else 0 end
  ) parts;
$$;

revoke execute on function public.profile_completeness(uuid) from public;
grant  execute on function public.profile_completeness(uuid) to authenticated, service_role;
