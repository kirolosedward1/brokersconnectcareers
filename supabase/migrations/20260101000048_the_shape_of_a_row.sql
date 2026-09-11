-- =============================================================================
-- 48 — Two files that were never checked to be yours, and text with no ceiling
--
-- Every form caps what it accepts. Only some of those caps are also facts
-- about the table: agent_experience.highlights, saved_searches.query and
-- applications.decision_note carry length checks, and jobs, companies,
-- profiles and agent_profiles carry none. A request that does not come from
-- the form — which is every request, as far as the database is concerned —
-- could put an eight megabyte description on a listing, and the only thing
-- standing in its way was a Zod schema in a file the request never touched.
--
-- The caps here are the forms' own numbers, so nothing anybody can type is
-- newly refused, and only the caps — see the note above the jobs block. Production's longest job description is 218 characters and
-- its longest applicant note is 48, so every constraint validates against the
-- existing rows with nothing to backfill — checked before writing this.
--
-- The two that are not about length:
--
--   applications.cv_path      applyToJob refuses a path outside the
--                             applicant's own folder, and a request that
--                             skips the action was refused by nothing at all.
--                             The insert policy checks who the row belongs to,
--                             the listing's status and the applicant's role —
--                             never the file. So a candidate who knew another
--                             candidate's cv_path could attach that CV to
--                             their own application, and the employer would
--                             open it: /api/cv/[applicationId] reads the row
--                             through RLS, sees a row that is genuinely
--                             theirs to read, and signs whatever path it
--                             holds. Paths are not guessable, but they are not
--                             secret either — get_agent_card() returns cv_path
--                             for any profile set to `public`, to anyone.
--
--   agent_profiles.cv_path    The same check saveAgentProfile makes, for the
--                             same reason.
--
-- Written as a storage-path prefix rather than a foreign key because storage
-- objects are not a table this schema can reference. It is the same rule the
-- storage policies enforce one level down — a folder named for the account —
-- restated where the row lives.
-- =============================================================================

alter table applications
  add constraint applications_cv_is_the_applicants
  check (cv_path is null or cv_path like candidate_id::text || '/%');

alter table agent_profiles
  add constraint agent_profiles_cv_is_the_owners
  check (cv_path is null or cv_path like user_id::text || '/%');

-- Lengths, matching the forms.
alter table applications
  add constraint applications_note_length check (length(note) <= 500),
  add constraint applications_cv_path_length check (length(cv_path) <= 512);

/*
  Ceilings, not floors.

  The forms also set minimums — a title of at least three characters, a
  description of at least twenty — and those are editorial rules about what
  makes a listing worth reading, not statements about what a row may be. A
  short description is a poor advert; it is not a corrupt one, and a floor in
  the table would refuse a data migration, a moderator's edit or a seed for a
  reason that has nothing to do with integrity. The only floors here are on
  names, where an empty string is a row claiming to have a name and not having
  one.
*/
alter table jobs
  add constraint jobs_title_ar_length            check (length(btrim(title_ar)) between 1 and 160),
  add constraint jobs_title_en_length            check (length(title_en) <= 160),
  add constraint jobs_description_ar_length      check (length(description_ar) <= 8000),
  add constraint jobs_description_en_length      check (length(description_en) <= 8000),
  add constraint jobs_requirements_ar_length     check (length(requirements_ar) <= 4000),
  add constraint jobs_commission_note_ar_length  check (length(commission_note_ar) <= 500),
  add constraint jobs_basic_salary_ceiling       check (coalesce(basic_salary_max, 0) <= 10000000),
  add constraint jobs_commission_percentage      check (commission_value is null or commission_value between 0 and 100);

alter table companies
  add constraint companies_name_ar_length  check (length(btrim(name_ar)) between 1 and 160),
  add constraint companies_name_en_length  check (length(name_en) <= 160),
  add constraint companies_about_ar_length check (length(about_ar) <= 2000),
  add constraint companies_about_en_length check (length(about_en) <= 2000),
  add constraint companies_website_length  check (length(website) <= 200);

alter table profiles
  add constraint profiles_full_name_length check (length(btrim(full_name)) between 1 and 120);

alter table agent_profiles
  add constraint agent_profiles_headline_ar_length check (length(headline_ar) <= 160),
  add constraint agent_profiles_headline_en_length check (length(headline_en) <= 160),
  add constraint agent_profiles_cv_path_length     check (length(cv_path) <= 512);

-- ---------------------------------------------------------------------------
-- A publication window that runs forwards
--
-- stamp_job_publication derives both dates, so this cannot be violated through
-- any path the product has — which is the argument for writing it down rather
-- than against it. The trigger is one `create or replace` away from a mistake
-- nobody would notice: a listing with an expiry before its publication is
-- simultaneously live and over, and every read that asks the date would
-- disagree with every read that asks the label.
-- ---------------------------------------------------------------------------

alter table jobs
  add constraint jobs_publication_window
  check (published_at is null or expires_at is null or expires_at > published_at);

-- ---------------------------------------------------------------------------
-- A consultant directory of consultants, one level below the policy
--
-- Migration 43 put `is_candidate()` on agent_profiles_write_own, which settles
-- it for anybody speaking to PostgREST as themselves. It settles nothing for
-- the service role, which bypasses RLS entirely and is what the seed, the
-- crons and every admin path use — and "an employer listed in the consultant
-- directory" is a corrupt state whoever wrote it.
--
-- The same shape as company_member_role in migration 22: a trigger, because a
-- CHECK cannot look at another table.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_agent_is_candidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
begin
  select role into v_role from profiles where id = new.user_id;

  if v_role is distinct from 'candidate' then
    raise exception 'agent_profile_role'
      using hint = 'Only a candidate account can have a consultant profile.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_agent_is_candidate() from public, anon, authenticated;

drop trigger if exists agent_profiles_10_role on agent_profiles;

create trigger agent_profiles_10_role
  before insert or update of user_id on agent_profiles
  for each row execute function public.enforce_agent_is_candidate();

-- ---------------------------------------------------------------------------
-- The one foreign key still leading nothing
--
-- application_events.actor_id, added in migration 42. Migration 30 declined to
-- index audit columns on the grounds that nothing filters on them, and
-- migration 39 reversed that for six keys once the linter pointed at them. The
-- deciding argument is the same one 39 gave and it applies here: actor_id is
-- `on delete set null`, so closing an account scans this table end to end, and
-- closing an account is a button a candidate can press.
--
-- Every other foreign key in the schema already leads an index — checked, not
-- assumed.
-- ---------------------------------------------------------------------------

create index if not exists application_events_actor_idx on application_events (actor_id);

-- ---------------------------------------------------------------------------
-- On the shape of this migration
--
-- Every constraint above is added validated rather than NOT VALID then
-- validated separately. The split exists to keep a long validation scan off an
-- ACCESS EXCLUSIVE lock, and these tables are eighteen jobs, thirty-two
-- applications and sixteen profiles — the scan is shorter than the round trip
-- that starts it. Each was checked against production first: zero rows violate
-- any of them, so there is nothing to backfill and nothing to exempt.
--
-- Reversing this is `alter table … drop constraint`, per name, plus dropping
-- the trigger and the index at the end. Nothing here rewrites a row.
-- ---------------------------------------------------------------------------
