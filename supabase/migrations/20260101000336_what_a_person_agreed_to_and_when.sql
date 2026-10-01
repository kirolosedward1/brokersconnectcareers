-- =============================================================================
-- 336 — What a person agreed to, and when
--
-- Two things the privacy policy and the terms already said, that nothing
-- recorded.
--
-- 1. Agreement. The terms say an account is opened on accepting them, and the
--    privacy policy that the platform is for people of eighteen and over. The
--    app's onboarding had a checkbox that never left the phone; the website had
--    none. Now both ask — "I am 18 or older, and I have read and agree to the
--    Terms of use and the Privacy policy" — and the server writes what was
--    agreed to:
--
--      policy_acceptances   one row per acceptance: the person, the version of
--                           each document (its `updated` date) and when.
--      record_policy_acceptance(terms, privacy)
--                           the only way in, as the caller, stamped by the
--                           database's clock. The same pair twice is one row.
--
--    Read by its owner (and admins, for a dispute). It goes with the account.
--
-- 2. Being listed. A candidate's directory card was created at onboarding with
--    visibility `verified_employers_only`, without a question: every approved
--    company saw an anonymous card, and verified ones the name, the photo and a
--    way to ask for the number and the CV. The policy said this happened "only
--    if you chose". Now onboarding asks, with no answer chosen in advance:
--
--      agent_profiles.visibility default 'hidden'
--                           a card nobody chose to show is shown to nobody.
--      agent_profiles.visibility_chosen_at
--                           when the owner last chose, stamped by the database
--                           whenever the owner sets visibility (a value that
--                           changes, or the profile form's save, which always
--                           asks). Null on cards made before this: their owners
--                           are asked on their dashboard. An admin hiding a card
--                           is not its owner choosing, and stamps nothing.
--
--    Existing cards keep the visibility they have: changing what somebody's
--    profile shows is theirs to do, and the dashboard asks them.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: drop trigger if exists agent_profiles_06_visibility_choice on agent_profiles; drop function if exists public.stamp_visibility_choice(), public.record_policy_acceptance(text, text); alter table agent_profiles drop column visibility_chosen_at, alter column visibility set default 'verified_employers_only'; drop table policy_acceptances;
-- safety: ships-with-code — the new code writes acceptances and choices only through what this adds, and reads them tolerating their absence (no notice is shown, onboarding still completes); old code never touches them, and the visibility default only applies to an insert that names no visibility, which the new onboarding never does and the old one always did — so applied first, a card made by the old onboarding is hidden rather than listed, the privacy-safe side
-- safety: rls — the policies are on policy_acceptances, which this file creates; nothing on an existing table's policies changes

-- ---------------------------------------------------------------------------
-- 1. Agreement
-- ---------------------------------------------------------------------------

create table if not exists policy_acceptances (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references profiles (id) on delete cascade,
  -- The documents' `updated` dates, which is what their pages print.
  terms_version   text not null check (terms_version ~ '^\d{4}-\d{2}-\d{2}$'),
  privacy_version text not null check (privacy_version ~ '^\d{4}-\d{2}-\d{2}$'),
  accepted_at     timestamptz not null default now()
);

comment on table policy_acceptances is
  'Each time a person agreed to the Terms of use and the Privacy policy (and confirmed being 18 or older): which versions, and when. Written only by record_policy_acceptance(). Migration 336.';

create index if not exists policy_acceptances_user_idx on policy_acceptances (user_id, accepted_at desc);

alter table policy_acceptances enable row level security;

create policy policy_acceptances_select_own on policy_acceptances
  for select to authenticated using (user_id = (select auth.uid()));

create policy policy_acceptances_admin_read on policy_acceptances
  for select to authenticated using ((select public.is_admin()));

-- No insert, update or delete policy: a person's record of what they agreed to
-- is written by the function below and never edited.
revoke insert, update, delete, truncate on policy_acceptances from anon, authenticated;

create or replace function public.record_policy_acceptance(p_terms_version text, p_privacy_version text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- A second press, a retried request, onboarding run twice: the same pair is
  -- already recorded, and a record of agreement does not need it twice.
  if exists (
    select 1 from policy_acceptances
     where user_id = v_uid
       and terms_version = p_terms_version
       and privacy_version = p_privacy_version
  ) then
    return;
  end if;

  insert into policy_acceptances (user_id, terms_version, privacy_version)
  values (v_uid, p_terms_version, p_privacy_version);
end;
$$;

revoke all on function public.record_policy_acceptance(text, text) from public, anon;
grant execute on function public.record_policy_acceptance(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Being listed
-- ---------------------------------------------------------------------------

alter table agent_profiles alter column visibility set default 'hidden';

alter table agent_profiles add column if not exists visibility_chosen_at timestamptz;

comment on column agent_profiles.visibility_chosen_at is
  'When the owner last chose who sees this card (database time). Null: never asked — the card predates migration 336.';

create or replace function public.stamp_visibility_choice()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only the owner choosing counts. An admin's lever, a service-role job and a
  -- definer function acting for somebody else leave the stamp as it was.
  if (select auth.uid()) is distinct from new.user_id then
    if tg_op = 'UPDATE' then
      new.visibility_chosen_at := old.visibility_chosen_at;
    else
      new.visibility_chosen_at := null;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- The client marks a choice by sending any value; the time is the
    -- database's, so nobody can date a choice they did not make.
    if new.visibility_chosen_at is not null then
      new.visibility_chosen_at := now();
    end if;
  elsif new.visibility is distinct from old.visibility
     or new.visibility_chosen_at is distinct from old.visibility_chosen_at then
    new.visibility_chosen_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.stamp_visibility_choice() from public, anon, authenticated;

drop trigger if exists agent_profiles_06_visibility_choice on agent_profiles;
create trigger agent_profiles_06_visibility_choice
  before insert or update on agent_profiles
  for each row execute function public.stamp_visibility_choice();
