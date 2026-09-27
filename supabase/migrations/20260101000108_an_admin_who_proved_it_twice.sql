-- =============================================================================
-- 108 — An admin who proved it twice
--
-- Every admin policy, every guard's bypass and every moderation function
-- asks is_admin(), and is_admin() asked one thing: does this account's profile
-- say admin. A stolen admin session — a laptop left open, a token in a log,
-- a phishing page — was the whole platform: every CV, every phone number,
-- every document, and the lever that suspends anyone.
--
-- Supabase issues a second factor as a claim on the token: `aal` is `aal2`
-- once the person has answered a TOTP challenge in this session, `aal1` until
-- then. is_admin() now requires it — for any admin who has enrolled a factor.
-- An admin who has not enrolled keeps working, because the alternative is a
-- migration that locks every reviewer out at once; the console pushes them
-- through enrolment, and once the factor exists the database no longer
-- accepts the account without it.
--
-- That is the rule Supabase documents as "enforce MFA for users who have
-- enrolled", moved from the application into the one function the policies
-- already trust. It is evaluated only when the profile row says admin, so
-- every other account pays nothing for it.
-- =============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select p.role = 'admin'
       and (
         coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
         or not exists (
           select 1 from auth.mfa_factors f
            where f.user_id = p.id and f.status = 'verified'
         )
       )
      from profiles p
     where p.id = auth.uid()
  ), false);
$$;
