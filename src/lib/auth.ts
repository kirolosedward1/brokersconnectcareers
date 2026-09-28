import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';
import type { Locale } from '@/i18n/routing';
import {
  canAccessAdminArea,
  canAccessCandidateArea,
  canAccessEmployerArea,
  canBrowseAgentDirectory,
  canViewAgentProfile,
  directoryDeniedRedirect,
  homeFor,
  isAdmin,
  type Actor,
} from '@/lib/permissions';

export type Viewer = {
  userId: string;
  email: string | null;
  /** Name the identity provider gave us, used to pre-fill onboarding. */
  suggestedName: string;
  /**
   * The account type chosen on the sign-up door, kept in user metadata so it
   * survives a confirmation link that carries no query string. A suggestion
   * for onboarding only — the profile row is the decision, and this is never
   * read once one exists.
   */
  suggestedRole?: 'candidate' | 'employer';
  profile: ProfileRow | null;
  company: CompanyRow | null;
  /**
   * The profile row could not be read — as distinct from not existing.
   *
   * The absence of a profile is how this app knows onboarding has not run, so
   * a failed read looked exactly like a new account: a database blip sent an
   * established user back through the sign-up form. Recorded rather than
   * flattened, so the protected pages can say "something went wrong" while the
   * public header carries on treating an unreachable database as "nobody is
   * signed in", which is all it needs to know.
   */
  profileUnreadable: boolean;
};

/**
 * The signed-in user together with their profile and (for anyone who acts
 * for a company) their company. Cached per request, so calling it from a
 * layout and again from a page inside that layout costs one round trip, not
 * two.
 *
 * A null profile means the user authenticated but has not been through
 * /onboarding yet — the absence of the row is the signal.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // The site header calls this on every page, including the landing page, the
  // blog and the legal pages, none of which need a database. Treat an
  // unconfigured or unreachable Supabase as "nobody is signed in" rather than
  // letting it 500 the entire site.
  let supabase;
  let user;
  try {
    supabase = await createClient();
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch (error) {
    // Next signals control flow by throwing: redirect, notFound, and the
    // dynamic-server-usage error that reading cookies raises during static
    // generation. Catching those turns a page that should have been marked
    // dynamic into one rendered as though nobody were signed in. Only a real
    // failure to reach Supabase should fall through to "signed out".
    unstable_rethrow(error);

    console.warn(
      '[auth] could not determine the current user:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }

  if (!user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  let company: CompanyRow | null = null;
  if (profile?.role === 'employer' || profile?.role === 'admin') {
    /*
      Through membership, not ownership.

      A company is a team: row-level security lets any member read its jobs
      and applicants and post on its behalf, and only an admin member edit
      the company itself. Keyed on owner_id this returned null for every
      colleague who was invited rather than signing up — so a recruiter with
      full database access saw a console with no company in it, and the
      contact button on the consultant directory, which gates on
      viewer.company, never appeared for them.

      my_company_id() is the single answer to "which company am I acting
      for", and it breaks ties deterministically: admin first, then oldest.

      Admins too. The rail offered an admin the whole employer console and
      this never looked their company up, so every page in it rendered the
      "create your company first" state — including for an admin who runs
      one. An admin with no membership gets null here and no employer console.
    */
    const { data: companyId } = await supabase.rpc('my_company_id');
    if (companyId) {
      const { data } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
      company = data ?? null;
    }
  }

  const metadata = user.user_metadata ?? {};
  const suggestedName =
    (typeof metadata.full_name === 'string' && metadata.full_name) ||
    (typeof metadata.name === 'string' && metadata.name) ||
    (user.email ? user.email.split('@')[0] : '');

  const suggestedRole =
    metadata.role === 'candidate' || metadata.role === 'employer' ? metadata.role : undefined;

  return {
    userId: user.id,
    email: user.email ?? null,
    suggestedName,
    suggestedRole,
    profile: profile ?? null,
    company,
    profileUnreadable: Boolean(profileError),
  };
});

/** Signed in and onboarded, or bounced. */
export async function requireProfile(locale: Locale): Promise<Viewer & { profile: ProfileRow }> {
  const viewer = await getViewer();
  if (!viewer) redirect({ href: '/sign-in', locale });

  /*
    A read that failed is not an account that has not onboarded.

    Both arrive here as `profile: null`, and treating them alike sent somebody
    with a perfectly good account back to /onboarding the moment the database
    hiccupped — where the form would have been filled in again, met the
    duplicate key, and bounced them onward. Thrown instead, so the console's
    error boundary says what actually happened and offers Retry, with the
    shell still around it.
  */
  if (viewer!.profileUnreadable) {
    throw new Error('the profile row could not be read');
  }

  if (!viewer!.profile) redirect({ href: '/onboarding', locale });
  return viewer as Viewer & { profile: ProfileRow };
}

/**
 * The employer console: an employer, or an admin who belongs to a company.
 *
 * Everybody else goes home — to the place `homeFor` names for them, so a
 * candidate lands on their dashboard and an admin with no company on the
 * moderation queues rather than on a console full of empty states.
 */
export async function requireEmployer(locale: Locale) {
  const viewer = await requireProfile(locale);
  if (!canAccessEmployerArea(viewer)) {
    redirect({ href: homeFor(viewer), locale });
  }
  return viewer;
}

/**
 * The candidate's own pages. Candidates only: an employer goes to their
 * console and an admin to theirs. An admin used to be let through here and
 * ended up on a dashboard with no rail entry pointing back to it.
 */
export async function requireCandidate(locale: Locale) {
  const viewer = await requireProfile(locale);
  if (!canAccessCandidateArea(viewer)) {
    redirect({ href: homeFor(viewer), locale });
  }
  return viewer;
}

/**
 * Whether an admin without a second factor may use the console at all.
 *
 * On by default in production, off in development, and settable either way:
 * ADMIN_MFA_REQUIRED=false is the escape hatch for a locked-out team, and it
 * is an escape hatch rather than the setting because the database enforces
 * the stronger half regardless (migration 311 — an admin who *has* enrolled is
 * refused at aal1 by every policy, whatever this says).
 */
function adminMfaRequired(): boolean {
  const flag = process.env.ADMIN_MFA_REQUIRED;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export async function requireAdmin(locale: Locale) {
  const viewer = await requireProfile(locale);
  if (!canAccessAdminArea(viewer)) {
    redirect({ href: homeFor(viewer), locale });
  }

  /*
    The second factor, asked of the session rather than of the profile.

    `currentLevel` is what this session proved; `nextLevel` is what the
    account could prove. An admin with a factor and an aal1 session is sent
    to answer the challenge — and would find every admin query returning
    nothing until they do, because is_admin() reads the same claim. An admin
    with no factor is sent to enrol, where the deployment says so. The account
    page is outside this guard, so neither redirect can loop.
  */
  const supabase = await createClient();
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance && assurance.currentLevel !== 'aal2') {
    if (assurance.nextLevel === 'aal2') {
      redirect({ href: '/dashboard/account?mfa=challenge', locale });
    } else if (adminMfaRequired()) {
      redirect({ href: '/dashboard/account?mfa=required', locale });
    }
  }

  return viewer;
}

/**
 * The consultant directory: an approved employer or an admin.
 *
 * The page is the courtesy; the database is the rule. `search_agents()` and
 * every agent_profiles policy already answer a candidate with nothing, so a
 * candidate who typed /agents would see an empty directory rather than
 * anybody's data. This sends them somewhere that makes sense instead.
 */
export async function requireDirectoryViewer(locale: Locale) {
  const viewer = await requireProfile(locale);
  if (!canBrowseAgentDirectory(viewer)) {
    redirect({ href: directoryDeniedRedirect(viewer), locale });
  }
  return viewer;
}

/**
 * One consultant's page: the directory's readers, or the consultant it
 * belongs to. Called after the card has been fetched, because the card is
 * what says whose it is — and get_agent_card() has already refused to return
 * one to anybody outside these two groups, so `agent` being present is
 * itself most of the answer.
 */
export async function requireAgentProfileViewer(
  locale: Locale,
  agent: { user_id: string | null },
): Promise<Viewer & { profile: ProfileRow }> {
  const viewer = await requireProfile(locale);
  if (!canViewAgentProfile(viewer, agent)) {
    redirect({ href: directoryDeniedRedirect(viewer), locale });
  }
  return viewer;
}

/** The viewer as the permission helpers see them. */
export function actorOf(viewer: Viewer | null): Actor {
  if (!viewer) return null;
  return {
    userId: viewer.userId,
    profile: viewer.profile
      ? { role: viewer.profile.role, approval_status: viewer.profile.approval_status }
      : null,
    company: viewer.company
      ? { id: viewer.company.id, verification_status: viewer.company.verification_status }
      : null,
  };
}

export { isAdmin };
