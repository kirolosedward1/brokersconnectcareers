-- =============================================================================
-- 348 — A company is told when its verification is taken away
--
-- A moderator revoking a company's verification (admin_review_company,
-- 'revoke') took the badge away and told nobody: on_company_verified rang for
-- a verification and for a refusal, not for this. The company's members now
-- hear it in the bell, by push under the account switch, and by email from
-- the console's action: the badge has gone, and the company page is where to
-- ask again. Not the moderator's reason, which the console keeps; whoever
-- wants to know more writes in. Tested in supabase/tests/notices.test.mjs.
-- =============================================================================

-- rollback: restate on_company_verified() from migration 345; the enum value stays (Postgres cannot drop one) and goes unused
-- safety: ships-with-code — the new code knows the kind and emails a revocation whether or not this file is applied (the email needs nothing from it); applied before the deploy, main's bell shows the new kind as its generic line and main sends no email for it, until the code arrives

alter type notification_kind add value if not exists 'company_verification_revoked';

create or replace function public.on_company_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status is not distinct from old.verification_status then
    return new;
  end if;

  begin
    if new.verification_status = 'verified' then
      perform public.notify_company(
        new.id,
        'company_verified',
        jsonb_build_object('name_ar', new.name_ar, 'name_en', new.name_en),
        '/employer/company',
        -- Once ever, like the email: a badge that flaps is not news twice.
        'company_verified:' || new.id
      );
    elsif new.verification_status = 'rejected'
       -- A reviewer sending the papers back for changes: the company is the
       -- one who has to act, exactly as after a refusal. Asked of the review
       -- (is_admin), because the documents' own trigger takes the same path
       -- back to unverified when the database removes the last paper waiting
       -- (company_review_state, migration 44), and that asks nothing of anyone.
       or (new.verification_status = 'unverified' and old.verification_status = 'pending'
           and public.is_admin())
    then
      perform public.notify_company(
        new.id,
        'company_verification_needed',
        jsonb_build_object('name_ar', new.name_ar, 'name_en', new.name_en),
        '/employer/company',
        -- Per version: each refusal can carry a different reason.
        'company_verification_needed:' || new.id || ':' || new.version
      );
    elsif new.verification_status = 'unverified' and old.verification_status = 'verified'
      -- A moderator's revocation (admin_review_company 'revoke'), the only
      -- way a verified company becomes unverified: asked of the review, as a
      -- request for changes is, so nothing the database does on its own
      -- reads as a decision.
      and public.is_admin()
    then
      perform public.notify_company(
        new.id,
        'company_verification_revoked',
        jsonb_build_object('name_ar', new.name_ar, 'name_en', new.name_en),
        '/employer/company',
        -- Per version: verified again and revoked again is news again.
        'company_verification_revoked:' || new.id || ':' || new.version
      );
    end if;
  exception when others then
    raise warning 'notification for company % failed: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;
