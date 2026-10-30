-- =============================================================================
-- 371 — A team of five
--
-- A company's team is at most five people, the owner included (the owner is
-- a member: migration 22 adds their row as admin when the company is made).
-- Decided with the v1.1 Phase B review (docs/design/v1.1/phase-b/03).
--
-- Enforced here rather than in addCompanyMember, so every door that adds a
-- member — the website's form, the app's, an admin's — meets the same
-- number. The company's row is locked while counting, so two invitations
-- sent at the same moment cannot both take the fifth place.
--
-- A team already larger than five keeps everybody: nobody is removed, and
-- nobody more can be added until it is under the cap.
--
-- rollback: drop trigger if exists company_members_20_team_cap on company_members;
--           drop function if exists public.company_team_cap();
-- safety: additive — a new trigger on insert only. Existing rows are untouched.
-- safety: ships-with-code — code first: no sixth member is refused yet; migration first: older
--   code shows its generic error for team_full, which only a sixth member can meet.
-- =============================================================================

create or replace function public.company_team_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- One invitation at a time per company: the second waits for the first's count.
  perform 1 from companies where id = new.company_id for update;
  select count(*) into v_count from company_members where company_id = new.company_id;
  if v_count >= 5 then
    raise exception 'team_full'
      using hint = 'A company team is at most five people, the owner included.';
  end if;
  return new;
end;
$$;

revoke execute on function public.company_team_cap() from public, anon, authenticated;

drop trigger if exists company_members_20_team_cap on company_members;
create trigger company_members_20_team_cap
  before insert on company_members
  for each row execute function public.company_team_cap();
