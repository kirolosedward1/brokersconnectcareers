-- =============================================================================
-- 47 — A rule stated in one path and not kept in the other
--
-- set_account_approval() refuses an admin approving themselves, in words:
-- "an admin cannot change their own approval". The policy suite asserts it.
-- And a direct PostgREST update to profiles does it anyway — guard_profile_update
-- returns early for an admin before it reaches any of its checks, and
-- profiles_admin_all permits the write.
--
-- This is not an escalation. An admin can already approve anybody, so nothing
-- is gained by approving themselves, and the accounts table is not where the
-- platform's trust boundary sits. It is the same shape as the withdrawal rule
-- in migration 42: something the product says out loud, in an error message
-- somebody wrote deliberately, that the database does not actually keep. Two
-- answers to one question is how the wrong one gets relied on.
--
-- Placed inside the admin short-circuit rather than above it. A non-admin
-- changing their own role or approval is already refused by the checks below,
-- with messages that say which of the two they touched — putting a broader
-- rule in front of them would replace good errors with a vaguer one to catch a
-- case they already catch. Nothing else about an admin's own row changes:
-- their name, avatar, locale and notification switches are still theirs to
-- edit, because `is distinct from` sees no change in the columns this is
-- about.
--
-- set_account_approval is SECURITY DEFINER and writes other people's rows, so
-- it is unaffected — and it keeps its own check, which produces the better
-- error message of the two.
-- =============================================================================

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.acting_as_admin() then
    -- The one thing the short-circuit does not wave through. Same wording as
    -- set_account_approval(), which has refused this since migration 16 and
    -- was the only thing refusing it.
    if new.id = (select auth.uid())
       and (new.role, new.approval_status, new.approved_at)
           is distinct from
           (old.role, old.approval_status, old.approved_at)
    then
      raise exception 'an admin cannot change their own approval';
    end if;

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
