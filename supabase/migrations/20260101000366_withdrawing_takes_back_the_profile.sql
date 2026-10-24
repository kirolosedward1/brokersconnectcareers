-- =============================================================================
-- 366 — Withdrawing takes back the profile, the number with it
--
-- Applying is consent (migration 43): it is what lets a company read the
-- applicant's profiles row — their name and WhatsApp number — through
-- profiles_select_applicants (migration 4). Until 362 a withdrawal deleted
-- the application, and the consent went with the row. 362 keeps the row and
-- ended the consultant-profile half of that access (applied_to_my_job leaves
-- withdrawn applications out), but profiles_select_applicants still matched
-- any application, withdrawn ones included. So a person who withdrew stayed
-- readable by that company, number and all, for good: on the employer's
-- inbox (the number was in the page's data even where the card hid it) and
-- straight from PostgREST.
--
-- The policy now asks what applied_to_my_job asks: a standing application.
-- A withdrawn card keeps the listing, the dates and the history; the person
-- on it reads as "—", as it does for any profile a company may not see. A
-- new application to the company makes the profile readable again.
-- =============================================================================

-- rollback: drop policy if exists profiles_select_applicants on profiles; create policy profiles_select_applicants on profiles for select using (exists (select 1 from applications a where a.candidate_id = profiles.id and public.owns_job(a.job_id)));
-- safety: rls — narrows a read policy: it refuses only profiles whose every application to the company is withdrawn; every standing application keeps the read it had, and no write policy changes
-- safety: ships-with-code — no code reads a withdrawn applicant's profile on purpose: the inbox already hides contact on a withdrawn card and draws a missing profile as "—", so either order of deploy and migration leaves every page working

drop policy if exists profiles_select_applicants on profiles;

create policy profiles_select_applicants on profiles
  for select using (
    exists (
      select 1 from applications a
      where a.candidate_id = profiles.id
        and a.status <> 'withdrawn'
        and public.owns_job(a.job_id)
    )
  );
