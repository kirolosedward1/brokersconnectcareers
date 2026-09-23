-- =============================================================================
-- 67 — A company never said what kind it was
--
-- Two kinds of employer hire on this board and a consultant chooses between
-- them before anything else: a brokerage, which sells many developers' stock
-- and lives on commission, and a developer, which sells its own projects and
-- usually pays a basic. The board could be narrowed by track, district, lead
-- source, pay and experience, and not by the one distinction people in this
-- market make out loud — "I want to work for a developer".
--
-- It could not be added as a filter because nothing recorded it. The only
-- signal was the company's name, and a name is not data: «مدينة مصر» is a
-- developer and «مدينة نصر للعقارات» is a brokerage, and a rule that guesses
-- between them would put listings behind the wrong door.
--
-- So the company says it. Nullable, with no default and no backfill — every
-- existing company is unclassified until somebody who knows sets it, and an
-- unclassified company is simply absent from a by-type view rather than
-- counted under a guess. The home page hides the group entirely until at
-- least one live listing belongs to a classified company.
--
-- Text with a check rather than an enum, matching headcount_band beside it:
-- "both" or "property management firm" is a plausible third value, and adding
-- one to a check is a one-line migration where an enum value cannot be removed
-- again.
--
-- No policy changes. The column is covered by the row's existing policies:
-- anyone may read a company, only its admins may update it. It is not one of
-- the guarded columns (verification_status, post_credits) because a company
-- stating what it is grants it nothing.
-- =============================================================================

alter table companies
  add column company_type text
  check (company_type in ('brokerage', 'developer'));

comment on column companies.company_type is
  'Stated by the company, never inferred. Null means unclassified, which excludes it from by-type browsing.';

-- The by-type board filter joins jobs to companies on this; the partial index
-- keeps the unclassified majority out of it.
create index companies_company_type_idx
  on companies (company_type)
  where company_type is not null;
