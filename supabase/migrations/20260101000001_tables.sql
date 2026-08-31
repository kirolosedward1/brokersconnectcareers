-- =============================================================================
-- 01 — Core tables
-- =============================================================================

-- Profiles are NOT auto-created on auth.users insert. The absence of a row is
-- how the app knows a signed-in user has not finished onboarding yet, which is
-- what lets whatsapp_phone stay NOT NULL (see /onboarding).
create table profiles (
  id              uuid primary key references auth.users on delete cascade,
  role            user_role not null default 'candidate',
  full_name       text not null,
  whatsapp_phone  text not null,                -- E.164, +20...
  avatar_url      text,
  locale          text not null default 'ar' check (locale in ('ar', 'en')),
  created_at      timestamptz not null default now(),
  constraint profiles_whatsapp_e164 check (whatsapp_phone ~ '^\+[1-9]\d{7,14}$')
);

create table governorates (
  id       serial primary key,
  name_ar  text not null,
  name_en  text not null,
  slug     text unique not null
);

create table districts (
  id              serial primary key,
  governorate_id  int not null references governorates,
  name_ar         text not null,
  name_en         text not null,
  slug            text unique not null
);

-- Master list of developers, for portfolio tagging. Brokerages do not belong
-- here — this is a portfolio tag, not a company list.
create table developers (
  id       serial primary key,
  name_ar  text not null,
  name_en  text not null,
  slug     text unique not null
);

create table companies (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references profiles on delete cascade,
  name_ar              text not null,
  name_en              text,
  slug                 text unique not null,
  logo_url             text,
  about_ar             text,
  about_en             text,
  website              text,
  headcount_band       text check (headcount_band in ('1_10', '11_50', '51_200', '201_500', '500_plus')),
  district_id          int references districts,
  verification_status  verification_status not null default 'unverified',
  verified_at          timestamptz,
  post_credits         int not null default 0 check (post_credits >= 0),
  created_at           timestamptz not null default now()
);

create unique index companies_one_per_owner on companies (owner_id);

create table company_documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies on delete cascade,
  doc_type      text not null check (doc_type in ('commercial_register', 'tax_card')),
  storage_path  text not null,                  -- private bucket
  status        verification_status not null default 'pending',
  review_note   text,
  reviewed_by   uuid references profiles,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table jobs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies on delete cascade,
  title_ar           text not null,
  title_en           text,
  slug               text unique not null,
  track              job_track not null,
  employment_type    employment_type not null,
  experience_band    experience_band not null,
  seats              int not null default 1 check (seats between 1 and 999),
  district_id        int not null references districts,

  -- Compensation block: the core differentiator.
  basic_salary_min   int check (basic_salary_min >= 0),   -- EGP monthly; null = commission only
  basic_salary_max   int check (basic_salary_max >= 0),
  commission_type    commission_type not null,
  commission_value   numeric(5,2),                        -- e.g. 2.50 for 2.5%
  commission_note_ar text,
  leads_source       leads_source not null,

  benefits           text[] not null default '{}',
  description_ar     text not null,
  description_en     text,
  requirements_ar    text,

  status             job_status not null default 'draft',
  is_featured        boolean not null default false,
  featured_until     timestamptz,
  published_at       timestamptz,
  expires_at         timestamptz,                         -- published_at + 30 days
  view_count         int not null default 0,
  rejection_note     text,
  created_at         timestamptz not null default now(),

  constraint jobs_salary_range check (
    basic_salary_min is null or basic_salary_max is null or basic_salary_max >= basic_salary_min
  ),
  constraint jobs_benefits_allowed check (
    benefits <@ array['social_insurance','medical','transport','training','mobile_allowance']::text[]
  ),
  -- A percentage commission needs a number; the other types must not carry one.
  constraint jobs_commission_value check (
    (commission_type = 'percentage' and commission_value is not null)
    or (commission_type <> 'percentage' and commission_value is null)
  )
);

-- Full-text search. Arabic has no bundled stemmer, so 'simple' + unaccent is
-- the honest choice: it tokenises on whitespace and matches prefixes well.
alter table jobs add column search_vector tsvector
  generated always as (
    to_tsvector('simple',
      coalesce(title_ar, '') || ' ' ||
      coalesce(title_en, '') || ' ' ||
      coalesce(description_ar, '')
    )
  ) stored;

create table job_developers (
  job_id        uuid references jobs on delete cascade,
  developer_id  int references developers on delete cascade,
  primary key (job_id, developer_id)
);

create table applications (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references jobs on delete cascade,
  candidate_id       uuid not null references profiles on delete cascade,
  status             application_status not null default 'new',
  cv_path            text,
  note               text,
  experience_band    experience_band,
  employer_viewed_at timestamptz,
  created_at         timestamptz not null default now(),
  unique (job_id, candidate_id)
);

create table agent_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references profiles on delete cascade,
  slug              text unique not null,
  headline_ar       text,
  headline_en       text,
  years_experience  int not null default 0 check (years_experience between 0 and 60),
  tracks            job_track[] not null default '{}',
  district_ids      int[] not null default '{}',
  languages         text[] not null default '{}',
  cv_path           text,
  availability      agent_availability not null default 'open_to_offers',
  visibility        agent_visibility not null default 'verified_employers_only',
  created_at        timestamptz not null default now()
);

-- Developers this agent has sold.
create table agent_developers (
  agent_id      uuid references agent_profiles on delete cascade,
  developer_id  int references developers on delete cascade,
  primary key (agent_id, developer_id)
);

create table saved_jobs (
  candidate_id  uuid references profiles on delete cascade,
  job_id        uuid references jobs on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (candidate_id, job_id)
);

create table reports (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid references jobs on delete cascade,
  reporter_id  uuid references profiles on delete set null,
  reason       text not null check (reason in ('fake_listing','misleading_pay','duplicate','spam','discriminatory','other')),
  detail       text,
  resolved     boolean not null default false,
  resolved_by  uuid references profiles,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Billing. Tables exist from day one; the flow is dormant behind
-- BILLING_ENABLED until the board has candidate volume.
create table orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies on delete cascade,
  pack_key        text not null check (pack_key in ('single','bulk','mass_hiring','featured_addon')),
  credits         int not null,
  amount_egp      int not null check (amount_egp >= 0),
  paymob_order_id text,
  status          text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  created_at      timestamptz not null default now()
);

-- Tracks the "1 free single post per month for verified companies" grant so it
-- can be claimed exactly once per calendar month.
create table monthly_free_post_grants (
  company_id  uuid not null references companies on delete cascade,
  period      date not null,                   -- first day of the month
  granted_at  timestamptz not null default now(),
  primary key (company_id, period)
);
