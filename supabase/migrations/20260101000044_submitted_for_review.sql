-- =============================================================================
-- 44 — A company that submitted its papers and never joined the queue
--
-- `verification_status` has four values and the product only ever writes
-- three. Nothing moves a company to `pending`: the owner cannot —
-- guard_company_update refuses it, correctly — and the only other writer is
-- the admin review, which writes `verified` or `rejected`. So `pending` is a
-- state the enum offers and the application never reaches.
--
-- Two things read it and are wrong because of that:
--
--   admin_summary().companies_pending counts companies at `pending`, which is
--   always zero. The review queue itself is fine — it is built from documents
--   at `pending`, not from the company — so the badge on the admin overview
--   says nothing is waiting while the queue has work in it. Whoever is meant
--   to notice a new company is looking at the number, not the page.
--
--   The employer's setup checklist shows "waiting" only at `pending`, so an
--   employer who has uploaded their commercial register is still told, in a
--   list of things to do, to get verified.
--
-- Nothing on production has hit this yet: company_documents has never held a
-- row, so the first company to submit papers would have been the first to
-- disappear. The submission is the transition, so it happens where the
-- submission does.
--
-- The marker is migration 41's: a transaction-local setting that only a
-- definer function in this schema can turn on, and which PostgREST gives a
-- client no statement to set. What it permits is deliberately narrow — the
-- move to `pending`, from `unverified` or `rejected`, and nothing else. An
-- owner still cannot verify themselves, stamp verified_at, or transfer the
-- company.
-- =============================================================================

create or replace function public.guard_company_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then return new; end if;

  -- Verification is set by review, with one exception below it.
  if new.verification_status is distinct from old.verification_status then
    -- Submitting papers is a transition the company makes, and the only one.
    -- Anything other than unverified/rejected -> pending is still a refusal,
    -- so this cannot become a way to arrive at `verified`.
    if not (
      coalesce(current_setting('app.submitting_for_review', true), 'off') = 'on'
      and new.verification_status = 'pending'
      and old.verification_status in ('unverified', 'rejected')
    ) then
      raise exception 'verification_status is set by review, not by the owner';
    end if;
  end if;

  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is set by review, not by the owner';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'company ownership cannot be transferred';
  end if;

  -- Credits move only when platform code says it is granting them. The marker
  -- is transaction-local and set inside a SECURITY DEFINER function; a client
  -- speaking to PostgREST has no statement with which to set it.
  if new.post_credits is distinct from old.post_credits
     and coalesce(current_setting('app.granting_credits', true), 'off') <> 'on' then
    raise exception 'post_credits is set by billing, not by the owner';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The transition, on the row that causes it
-- ---------------------------------------------------------------------------

create or replace function public.company_review_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_pending int;
begin
  select count(*) into v_pending
    from company_documents
   where company_id = v_company and status = 'pending';

  perform set_config('app.submitting_for_review', 'on', true);

  if v_pending > 0 then
    update companies
       set verification_status = 'pending'
     where id = v_company
       and verification_status in ('unverified', 'rejected');
  else
    /*
      And back out again when the last pending document is withdrawn.

      An employer may delete a document while it is still pending — that is
      what company_documents_delete is for — and leaving the company at
      `pending` afterwards would put a row in the admin's count that the queue
      itself, which reads documents, no longer shows. `unverified` rather than
      `rejected` because nobody rejected anything; they changed their mind
      before a reviewer looked.
    */
    update companies
       set verification_status = 'unverified'
     where id = v_company
       and verification_status = 'pending';
  end if;

  perform set_config('app.submitting_for_review', 'off', true);
  return null;
end;
$$;

revoke execute on function public.company_review_state() from public, anon, authenticated;

drop trigger if exists company_documents_10_review_state on company_documents;

-- After insert and after delete, and deliberately not after update: a review
-- moves documents from `pending` to `verified` or `rejected` in the same
-- action that sets the company's own status, and a trigger recomputing it
-- from the documents would immediately undo that.
create trigger company_documents_10_review_state
  after insert or delete on company_documents
  for each row execute function public.company_review_state();

-- ---------------------------------------------------------------------------
-- Finding the colleague you are inviting
--
-- addCompanyMember looked an invitee up by listing the first 200 accounts on
-- the platform and scanning them in JavaScript. Correct today and wrong at
-- account 201, when inviting a colleague who does have an account starts
-- answering "no account with that email" — a wrong answer, delivered
-- confidently, with no way for either person to tell what happened.
--
-- service_role only. The lookup answers whether an address has an account,
-- which is not something to hand to every signed-in user; the server action
-- already establishes that the caller acts for a company before it asks, and
-- the membership row is still inserted through the caller's own session so
-- company_members_manage decides whether they may.
-- ---------------------------------------------------------------------------

create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant  execute on function public.user_id_by_email(text) to service_role;
