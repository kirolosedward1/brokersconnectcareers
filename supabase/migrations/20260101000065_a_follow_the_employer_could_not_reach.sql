-- =============================================================================
-- 65 — A follow the employer could not reach
--
-- Two controls were offered to anybody signed in: "Alert me" on the jobs board
-- and "Follow" on a company page. Both write the same row — a saved search —
-- and a saved search is a candidate's row. The weekly digest is worded for
-- somebody looking for work, the ten-row cap belongs to their dashboard, and
-- the one page that lists these rows, /dashboard/saved, sends employers to
-- /employer/jobs before it renders.
--
-- So an employer who pressed either of them got a row they could not see, a
-- follow they could only undo by finding the company again, a saved search
-- they could not undo at all, and a weekly email about "new jobs matching your
-- search" that they had no switch for. Nothing here was a leak — the policy
-- scoped every row to its owner — it was a feature handed to the side of the
-- market it was not built for.
--
-- The pages now offer the controls to candidates only, the way the bookmark on
-- a job card already did. This is the same rule in the place that can actually
-- hold it: a page is a courtesy, a policy is a rule, and the server action
-- behind both controls is reachable without either page.
--
-- Not the whole table, only INSERT. An employer who still holds a row after
-- this — an account an admin moved across from `candidate` — keeps SELECT,
-- UPDATE and DELETE on it, because taking those away would make the row
-- permanent as well as invisible.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- What employers already hold
--
-- Deleted, not silenced. These rows are unreachable to their owner by any
-- route the product offers, so leaving them turns off the mail but keeps a
-- balance against the ten-row cap that nobody can see or spend. A saved
-- search is derived data and one click to make again — the list component
-- says as much where it deletes optimistically — so removing them costs less
-- than keeping state a person cannot inspect.
--
-- Admins are left alone. /dashboard/saved renders for them (requireCandidate
-- turns away employers, not staff), so their rows are reachable and theirs to
-- delete.
-- ---------------------------------------------------------------------------

delete from saved_searches s
 using profiles p
 where p.id = s.candidate_id
   and p.role = 'employer';

-- ---------------------------------------------------------------------------
-- And no more of them
--
-- current_role_of_user() rather than is_candidate(): that one also demands an
-- approved account, which is the right test for applying to a job — it reaches
-- an employer — and the wrong one here. A suspended candidate saving a search
-- mails nobody but themselves, and refusing it would break the save button for
-- a reason the copy cannot explain.
--
-- Equality with `candidate` and not `<> 'employer'`, so admins are out too.
-- They keep the page and any rows they already have, but the board offers them
-- no control to make new ones — the bookmark on a job card has always tested
-- for `candidate` exactly, and the digest this feeds is written for somebody
-- looking for work. One rule, said the same way in the policy and in the page.
-- ---------------------------------------------------------------------------

drop policy if exists saved_searches_owner_insert on saved_searches;

create policy saved_searches_owner_insert on saved_searches
  for insert with check (
    candidate_id = (select auth.uid())
    and public.current_role_of_user() = 'candidate'
  );
