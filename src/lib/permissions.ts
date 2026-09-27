/**
 * Who may do what, decided in one place.
 *
 * Every role question the application asks — which console somebody lands
 * in, whether the directory link belongs in their navigation, whether a
 * profile page may render for them — is answered here and nowhere else. The
 * server guards in `auth.ts` call these; the site header and the console rail
 * call these; the page components call these. Desktop and phone navigation
 * are the same list because there is one list.
 *
 * None of this is the authorisation. Row-level security and the definer
 * functions in supabase/migrations decide what a request may read or write,
 * and they decide it for a request that never touched a page. What this file
 * decides is what to *show* and where to *send* somebody, and it is written
 * to say the same thing the database says — `canBrowseAgentDirectory` is
 * `can_browse_agent_directory()` restated — so a page never offers a door the
 * database will refuse.
 *
 * Pure, and importing types only: the auth suite loads it under Node with no
 * server runtime, the way it loads safe-next.ts.
 */

import type { ApprovalStatus, UserRole, VerificationStatus } from '@/lib/supabase/database.types';

/** The slice of a viewer these decisions need. `null` is a signed-out visitor. */
export type Actor = {
  userId: string;
  profile: { role: UserRole; approval_status: ApprovalStatus } | null;
  company: { id: string; verification_status: VerificationStatus } | null;
} | null;

/** Who somebody is, as the product sees them. */
export type Audience = 'anon' | 'onboarding' | 'candidate' | 'employer' | 'admin';

export function audienceOf(actor: Actor): Audience {
  if (!actor) return 'anon';
  if (!actor.profile) return 'onboarding';
  return actor.profile.role;
}

/** Suspended by an admin. Candidates and employers alike. */
export function isSuspended(actor: Actor): boolean {
  return actor?.profile?.approval_status === 'rejected';
}

/** In good standing: a candidate, or an employer whose account has been approved. */
export function isApproved(actor: Actor): boolean {
  return actor?.profile?.approval_status === 'approved';
}

export function isAdmin(actor: Actor): boolean {
  return actor?.profile?.role === 'admin';
}

export function isCandidate(actor: Actor): boolean {
  return actor?.profile?.role === 'candidate';
}

export function isEmployer(actor: Actor): boolean {
  return actor?.profile?.role === 'employer';
}

/** An employer account that may act — the database's `is_approved_employer()`. */
export function isApprovedEmployer(actor: Actor): boolean {
  return isEmployer(actor) && isApproved(actor);
}

/** A member of a verified company — the database's `viewer_has_verified_company()`. */
export function hasVerifiedCompany(actor: Actor): boolean {
  return actor?.company?.verification_status === 'verified';
}

// ---------------------------------------------------------------------------
// The consultant directory
// ---------------------------------------------------------------------------

/**
 * Who the directory answers: an admin, or an approved employer.
 *
 * Restates `can_browse_agent_directory()` from migration 68, which is what
 * `search_agents()`, `get_agent_card()` and the row policies actually check.
 * A candidate is never a directory reader, whatever they type into the
 * address bar; nor is a stranger, nor an employer still waiting for approval
 * or suspended after it.
 */
export function canBrowseAgentDirectory(actor: Actor): boolean {
  return isAdmin(actor) || isApprovedEmployer(actor);
}

/**
 * Whether a profile page may render for this viewer at all.
 *
 * The directory's readers, plus the one person with an unarguable claim: the
 * consultant whose profile it is, previewing what a company sees. The employer
 * an applicant applied to also reaches the card (migration 43), and for them
 * `canBrowseAgentDirectory` is already true — consent widens what the card
 * *shows*, not who may open the page.
 */
export function canViewAgentProfile(actor: Actor, agent: { user_id: string | null }): boolean {
  if (canBrowseAgentDirectory(actor)) return true;
  return Boolean(actor && agent.user_id && agent.user_id === actor.userId);
}

/**
 * Whether the contact block is offered.
 *
 * The number itself only ever arrives when the card is unlocked — the
 * database withholds it otherwise — so its presence is the authorisation.
 * What this adds is the second half: a contact button on the owner's own
 * preview would open WhatsApp to themselves, and an admin browsing the
 * directory is reviewing it, not hiring from it.
 */
export function canContactAgent(
  actor: Actor,
  card: { is_unlocked: boolean; whatsapp_phone: string | null; user_id?: string | null },
): boolean {
  if (!card.is_unlocked || !card.whatsapp_phone) return false;
  if (card.user_id && actor && card.user_id === actor.userId) return false;
  return isApprovedEmployer(actor) && Boolean(actor?.company);
}

/** Keeping a consultant is something a company does, so it needs one. */
export function canShortlistAgents(actor: Actor): boolean {
  return canBrowseAgentDirectory(actor) && Boolean(actor?.company);
}

// ---------------------------------------------------------------------------
// The three consoles
// ---------------------------------------------------------------------------

export function canAccessCandidateArea(actor: Actor): boolean {
  return isCandidate(actor);
}

/**
 * The employer console. An admin reaches it only when they are in a company —
 * every page under it is about the viewer's company, and an admin with none
 * would be handed a console full of "create your company first" panels that
 * the database refuses to honour (companies_insert_own requires the employer
 * role).
 */
export function canAccessEmployerArea(actor: Actor): boolean {
  return isEmployer(actor) || (isAdmin(actor) && Boolean(actor?.company));
}

export function canAccessAdminArea(actor: Actor): boolean {
  return isAdmin(actor);
}

/** The verification panel and the team roster are a company admin's; the pages check membership role themselves. */
export function canManageCompany(actor: Actor): boolean {
  return isApprovedEmployer(actor) || isAdmin(actor);
}

// ---------------------------------------------------------------------------
// Jobs and applications
// ---------------------------------------------------------------------------

/** Restates `applications_insert_candidate` and the candidate-only trigger. */
export function canApplyToJobs(actor: Actor): boolean {
  return isCandidate(actor) && isApproved(actor);
}

/** Restates `saved_jobs_owner_insert` and `saved_searches_owner_insert`. */
export function canSaveJobs(actor: Actor): boolean {
  return isCandidate(actor);
}

/** Restates `jobs_insert_owner`: an approved employer with a company to post for. */
export function canPostJobs(actor: Actor): boolean {
  return (isApprovedEmployer(actor) || isAdmin(actor)) && Boolean(actor?.company);
}

// ---------------------------------------------------------------------------
// Where people go
// ---------------------------------------------------------------------------

export type Home = '/sign-in' | '/onboarding' | '/dashboard' | '/employer' | '/admin';

/**
 * The one place each kind of account belongs after signing in, after
 * onboarding, and after being turned away from somewhere else.
 *
 * Three call sites used to answer this independently — the header's dashboard
 * button, the onboarding redirect, the middleware's default after sign-in —
 * and an admin was sent to the candidate's applications tab by two of them.
 */
export function homeFor(actor: Actor): Home {
  switch (audienceOf(actor)) {
    case 'anon':
      return '/sign-in';
    case 'onboarding':
      return '/onboarding';
    case 'candidate':
      return '/dashboard';
    case 'employer':
      return '/employer';
    case 'admin':
      return '/admin';
  }
}

/**
 * Where somebody turned away from a directory page goes.
 *
 * A candidate lands on their own profile editor — the one page of the
 * product that is about their directory entry — rather than on a generic
 * dashboard with no word about why. An employer who is not yet approved lands
 * on their console, which explains that state. Everybody else goes home.
 */
export function directoryDeniedRedirect(actor: Actor): string {
  if (isCandidate(actor)) return '/dashboard/profile?notice=directory';
  if (isEmployer(actor)) return '/employer';
  return homeFor(actor);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type SiteNavItem = { href: '/jobs' | '/companies' | '/agents' | '/blog'; key: 'jobs' | 'companies' | 'agents' | 'blog' };

/**
 * The public site's main navigation, by audience.
 *
 * One list, read by the desktop bar and the phone menu alike. The directory
 * appears only for the people who can open it; a candidate never sees a link
 * that would turn them away.
 */
export function siteNavFor(actor: Actor): SiteNavItem[] {
  const items: SiteNavItem[] = [
    { href: '/jobs', key: 'jobs' },
    { href: '/companies', key: 'companies' },
  ];
  if (canBrowseAgentDirectory(actor)) items.push({ href: '/agents', key: 'agents' });
  items.push({ href: '/blog', key: 'blog' });
  return items;
}

/**
 * Where "post a job" goes for this viewer, or nowhere.
 *
 * A signed-out visitor is sent through the employer door so they arrive at
 * the wizard as an employer rather than at the consultants' sign-in. A
 * candidate is offered nothing: the button was in the phone menu for every
 * role, and tapping it bounced them to their own dashboard.
 */
export function postJobHref(actor: Actor): string | null {
  if (!actor) return '/sign-in/employer?next=/employer/jobs/new';
  if (!actor.profile) return null;
  if (isEmployer(actor) || (isAdmin(actor) && actor.company)) return '/employer/jobs/new';
  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export type RouteAudience = 'public' | 'authenticated' | 'candidate' | 'directory' | 'employer' | 'admin';

/**
 * Every route prefix that is not public, and who it is for.
 *
 * The middleware turns anonymous visitors away from all of these; the page
 * guards in auth.ts enforce the audience. Kept as data so the auth suite can
 * assert the middleware's list and this one agree.
 */
export const PROTECTED_ROUTES: readonly { prefix: string; audience: RouteAudience }[] = [
  { prefix: '/onboarding', audience: 'authenticated' },
  { prefix: '/notifications', audience: 'authenticated' },
  { prefix: '/dashboard/account', audience: 'authenticated' },
  { prefix: '/dashboard', audience: 'candidate' },
  { prefix: '/agents', audience: 'directory' },
  { prefix: '/employer', audience: 'employer' },
  { prefix: '/admin', audience: 'admin' },
];

/** The prefixes the middleware must send anonymous visitors to sign in from. */
export const PROTECTED_PREFIXES: readonly string[] = [
  ...new Set(PROTECTED_ROUTES.map((route) => route.prefix.split('/').slice(0, 2).join('/'))),
];

export function routeAudience(path: string): RouteAudience {
  // Most specific first: /dashboard/account is for everyone signed in, while
  // /dashboard is the candidate's.
  const match = [...PROTECTED_ROUTES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((route) => path === route.prefix || path.startsWith(`${route.prefix}/`));
  return match?.audience ?? 'public';
}

/** Whether this actor may be shown a route of this audience. */
export function mayEnter(actor: Actor, audience: RouteAudience): boolean {
  switch (audience) {
    case 'public':
      return true;
    case 'authenticated':
      return Boolean(actor);
    case 'candidate':
      return canAccessCandidateArea(actor);
    case 'directory':
      return canBrowseAgentDirectory(actor);
    case 'employer':
      return canAccessEmployerArea(actor);
    case 'admin':
      return canAccessAdminArea(actor);
  }
}
