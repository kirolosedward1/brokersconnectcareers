-- =============================================================================
-- 16 — Account approval
--
-- A consultant signs up and is in. A company signs up and waits for a person
-- to look at them.
--
-- The asymmetry is the point. The cost of a bad candidate account is one
-- unwanted application; the cost of a bad employer account is a fake listing
-- collecting real people's phone numbers and CVs. This is a job board in a
-- market where that has a name and a price, so the side that collects
-- personal data is the side that gets checked by hand.
--
-- Note what a pending employer can still do: sign in, build their company
-- profile, upload their commercial registry. Blocking sign-in would mean an
-- employer could not submit the very documents the review is waiting for. What
-- they cannot do is create a listing — and that is enforced in the policy
-- below, not in a page, because a page is a courtesy and a policy is a rule.
--
-- Separate from companies.verification_status, which answers a different
-- question: that one is "did we check this company's papers", and it unlocks
-- the post cap, the consultant directory and the monthly free listing. This
-- one is "may this account act at all". A rejected account with verified
-- papers still cannot post.
-- =============================================================================

create type approval_status as enum ('approved', 'pending', 'rejected');

alter table profiles
  -- Approved by default so every account that already exists stays usable and
  -- so a candidate needs no special case anywhere. The trigger below is what
  -- makes employers wait.
  add column approval_status approval_status not null default 'approved',
  add column approval_note   text,
  add column approved_at     timestamptz;

create index profiles_pending_idx on profiles (created_at)
  where approval_status = 'pending';

-- ---------------------------------------------------------------------------
-- Who starts where
-- ---------------------------------------------------------------------------

create or replace function public.set_initial_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Set here rather than defaulted per role, because the column default cannot
  -- see the row. An admin is never created through this path — the role check
  -- in profiles_insert_self refuses it — so this only ever decides between the
  -- two public roles.
  if new.role = 'employer' then
    new.approval_status := 'pending';
    new.approved_at := null;
  else
    new.approval_status := 'approved';
    new.approved_at := now();
  end if;
  return new;
end;
$$;

create trigger profiles_00_set_initial_approval
  before insert on profiles
  for each row execute function public.set_initial_approval();

-- An account cannot approve itself. The existing guard already refuses role
-- changes and token rotation; approval is the same kind of field and belongs
-- beside them.
--
-- Restated in full because `create or replace` replaces the whole body, so
-- this has to carry every check the guard has accumulated — migration 05's
-- role check and migration 08's unsubscribe token — not only the new one. The
-- first draft of this migration carried only the role check and quietly
-- dropped the token; the policy suite caught it.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role changes are an admin action';
  end if;

  if new.unsubscribe_token is distinct from old.unsubscribe_token then
    raise exception 'unsubscribe_token is not user-writable';
  end if;

  if (new.approval_status, new.approval_note, new.approved_at)
     is distinct from
     (old.approval_status, old.approval_note, old.approved_at)
  then
    raise exception 'approval is an admin action';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- What approval gates
-- ---------------------------------------------------------------------------

create or replace function public.is_approved_employer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'employer' and approval_status = 'approved'
       from profiles where id = auth.uid()),
    false);
$$;

revoke execute on function public.is_approved_employer() from public;
grant  execute on function public.is_approved_employer() to anon, authenticated, service_role;

-- Applying now needs an account in good standing too, which gives moderation
-- a way to stop somebody spamming applications without deleting them.
create or replace function public.is_candidate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'candidate' and approval_status = 'approved'
       from profiles where id = auth.uid()),
    false);
$$;

-- Listings are the thing a pending employer must not be able to create. An
-- admin keeps their own path through jobs_admin_all.
drop policy if exists jobs_insert_owner on jobs;

create policy jobs_insert_owner on jobs
  for insert with check (
    public.owns_company(company_id)
    and public.is_approved_employer()
    -- Employers submit for review; they do not publish themselves, and they do
    -- not hand themselves a featured slot.
    and status in ('draft', 'pending_review')
    and is_featured = false
  );

-- ---------------------------------------------------------------------------
-- The admin's lever
--
-- A function rather than a policy, so there is exactly one place that can
-- change an approval and it carries the reason with it. Admins are excluded as
-- targets: an admin account demoting another admin through the same screen it
-- uses to approve employers is one misclick from locking the platform.
-- ---------------------------------------------------------------------------

create or replace function public.set_account_approval(
  p_user   uuid,
  p_status approval_status,
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_user = auth.uid() then
    raise exception 'an admin cannot change their own approval';
  end if;

  update profiles
     set approval_status = p_status,
         approval_note   = p_note,
         approved_at     = case when p_status = 'approved' then now() else null end
   where id = p_user
     and role <> 'admin';

  if not found then
    raise exception 'no such account, or it belongs to an admin';
  end if;
end;
$$;

revoke execute on function public.set_account_approval(uuid, approval_status, text) from public, anon;
grant  execute on function public.set_account_approval(uuid, approval_status, text) to authenticated, service_role;
