-- =============================================================================
-- 33 — Suspending an account takes its adverts down with it
--
-- Suspension stopped the account from doing anything new: is_approved_employer()
-- is in the insert policy for jobs, and is_candidate() is in the one for
-- applications. What it did not touch was everything already published.
--
-- So the case suspension exists for was the case it did not cover. An employer
-- is suspended because their listing is a fraud — and the listing stays on the
-- board, keeps its place in search and the sitemap, and keeps collecting
-- applications with real names, phone numbers and CVs attached. The account is
-- locked out of the console while the harm carries on without them.
--
-- A listing belongs to a company rather than to a person, so this cannot
-- simply close "their" adverts. The rule is the narrowest one that is still
-- honest: a company's listings come down when the account being suspended is
-- the last approved member it has. An agency where somebody else is still in
-- good standing keeps trading — one bad recruiter is not the firm — and a
-- one-person company, which is the shape of nearly every account on the
-- platform, comes down immediately.
--
-- Rejected rather than closed, because closed is the owner's own word for
-- "we have filled this" and would be a lie about what happened. Rejected is
-- reversible by an admin, carries the note, and is already what the employer's
-- own screens know how to explain.
-- =============================================================================

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

  if p_status = 'rejected' then
    /*
      The profile above is already suspended by the time this runs, so the
      "is anybody else still approved" test does not need to exclude the target
      by status — but it does exclude them by id, because a company whose only
      member has just been suspended must not count that member as cover for
      itself.

      Only live and awaiting-review listings are touched. Drafts are private
      already, and expired, closed or previously rejected ones are not on the
      board to take off it.
    */
    update jobs
       set status = 'rejected',
           rejection_note = coalesce(p_note, 'الحساب موقوف')
     where status in ('active', 'pending_review')
       and company_id in (
         select cm.company_id
           from company_members cm
          where cm.user_id = p_user
            and not exists (
              select 1
                from company_members peer
                join profiles p on p.id = peer.user_id
               where peer.company_id = cm.company_id
                 and peer.user_id <> p_user
                 and p.approval_status = 'approved'
            )
       );
  end if;
end;
$$;

revoke execute on function public.set_account_approval(uuid, approval_status, text) from public, anon;
grant  execute on function public.set_account_approval(uuid, approval_status, text) to authenticated, service_role;
