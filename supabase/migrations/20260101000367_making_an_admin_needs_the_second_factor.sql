-- =============================================================================
-- 367 — Making an admin needs the second factor
--
-- admin_set_role (355) runs behind admin_begin(), which asks is_admin(), which
-- asks for aal2 only of an admin who has a verified authenticator (311). An
-- admin who never enrolled — allowed while ADMIN_MFA_REQUIRED is unset — could
-- make new admins from a session that had shown nothing but a password, so a
-- stolen password of that one account was a way to mint more admins that
-- outlive a password reset.
--
-- Promotion now needs aal2 whoever asks. Demotion does not: it is the
-- containment step of RUNBOOKS.md A2, and must work from any admin session.
-- The function is 355's with that one check after admin_begin().
-- =============================================================================

-- rollback: re-run the create or replace function public.admin_set_role(uuid, user_role, text) block from migration 20260101000355_accounts_managed_from_one_place.sql
-- safety: ships-with-code — the console already sends an admin through the authenticator before the accounts page when one is enrolled; an unenrolled admin who tries to promote gets "forbidden" and the hint, which the console shows as the existing refusal copy. No code depends on promotion at aal1
-- safety: definer — the function keeps 355's owner, security definer and pinned search_path; the only change is an added refusal

create or replace function public.admin_set_role(
  p_user   uuid,
  p_role   user_role,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor   uuid;
  v_profile profiles%rowtype;
  v_reason  text;
begin
  v_actor := public.admin_begin();

  -- Making an admin is the one lever that makes more of the people who can
  -- pull every lever. It is not done from a session that has only shown a
  -- password: is_admin() asks an enrolled admin for aal2 already, and this
  -- asks it of an admin who has not enrolled too (ADMIN_MFA_REQUIRED unset
  -- leaves that console open). Demoting stays open at aal1 — taking a role
  -- away is how a compromised admin is contained (RUNBOOKS.md A2).
  if p_role = 'admin' and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'forbidden'
      using hint = 'Making an admin needs a session that answered the authenticator. Set one up under the account page first.';
  end if;

  if p_user = v_actor then
    raise exception 'an admin cannot change their own role';
  end if;

  v_reason := public.admin_reason(p_reason, true, 500);

  -- Role moves take turns: two admins taking each other's role at the same
  -- moment would each see the other still an admin, and leave none. Behind
  -- this lock the second sees the first's move before deciding.
  perform pg_advisory_xact_lock(hashtext('profiles:role'));

  select * into v_profile from profiles where id = p_user for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_profile.role = p_role then
    raise exception 'no_change' using hint = format('The account is already %s.', p_role);
  end if;
  -- Only the moves that make or unmake an admin. A candidate does not become
  -- an employer by an admin's hand: that is a company, a profile and a
  -- directory card, which onboarding makes and this would not.
  if v_profile.role <> 'admin' and p_role <> 'admin' then
    raise exception 'invalid_transition'
      using hint = 'An admin can make an account an admin, or an admin a candidate or employer again.';
  end if;
  -- An account still waiting, or suspended, is not made an admin: approve or
  -- restore it first, on the record, rather than have a promotion lift a hold
  -- nobody meant to lift (and send the "approved" email the header rules out).
  if p_role = 'admin' and v_profile.approval_status <> 'approved' then
    raise exception 'invalid_transition' using hint = 'Approve the account first.';
  end if;
  -- An account whose sign-in is blocked is not made an admin: the block is
  -- lifted only on a non-admin (admin_set_sign_in_block), so promoting it
  -- would make an admin nobody could let back in. Allow sign-in first.
  if p_role = 'admin' and exists (
    select 1 from auth.users u where u.id = p_user and u.banned_until is not null and u.banned_until > now()
  ) then
    raise exception 'invalid_transition' using hint = 'Allow the account to sign in first.';
  end if;
  -- Never the last admin. The actor cannot act on themselves, so in sequence
  -- one is always left; this holds under the lock above when the actor was
  -- demoted meanwhile.
  if v_profile.role = 'admin' and not exists (
    select 1 from profiles p where p.role = 'admin' and p.id <> p_user
  ) then
    raise exception 'last_admin' using hint = 'The console would be left with no admin.';
  end if;

  update profiles set role = p_role where id = p_user;

  perform public.admin_audit(
    case when p_role = 'admin' then 'user.promoted' else 'user.demoted' end,
    'user', p_user::text, v_profile.full_name, v_reason,
    jsonb_build_object('from', v_profile.role, 'to', p_role));
end;
$$;
