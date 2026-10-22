import { canAccessAdminArea, canAccessCandidateArea, canAccessEmployerArea, type Actor } from '@/lib/permissions';

/** The tabs, each named as the route group that is its stack: `(home)`, `(jobs)`… */
export type TabName =
  | 'home'
  | 'jobs'
  | 'companies'
  | 'applications'
  | 'saved'
  | 'account'
  | 'listings'
  | 'applicants'
  | 'consultants'
  | 'admin';

const PUBLIC: readonly TabName[] = ['home', 'jobs', 'companies', 'account'];
const CANDIDATE: readonly TabName[] = ['home', 'jobs', 'applications', 'saved', 'account'];
const EMPLOYER: readonly TabName[] = ['home', 'listings', 'applicants', 'consultants', 'account'];
/** The console first, so it is the tab the app opens on, then the account. */
const ADMIN: readonly TabName[] = ['admin', 'account'];

/**
 * The tab bar each person has, in order — decided by src/lib/permissions.ts,
 * as every other show-or-hide in the app is. Signed out, the public site and
 * the door. A candidate's bar is their console on the website: their
 * applications and what they saved take the places of the companies
 * directory, which is still a tap away from home (five tabs is what fits).
 * An employer's is theirs: the overview at home, their listings, their
 * applicants, the consultant directory, and the account — where the company,
 * its team and its billing are kept. An admin's is the console alone, then
 * the account — whether or not they also run a company. The company's page
 * and its billing stay in the account. A listing, a company, the consultant
 * directory and the shortlist opened from the console (or from a link) open
 * inside the Admin tab ((consultants,admin) and the shared stack in the
 * routes, links.ts), never in a tab the bar does not have.
 *
 * The bar changes with the role, never with the standing. Every tab's screens
 * are drawn again whenever the set of tabs changes, so a Consultants tab that
 * appeared on approval (and went on suspension) wiped a listing half written
 * in the wizard the moment the account was read again. The directory's own
 * screens say who it is for until canBrowseAgentDirectory lets somebody in;
 * links into it are still decided by the website's rules (links.ts).
 *
 * A tab left out is not only hidden: its screens are not in the app for that
 * person at all (a hidden native tab is a protected route), so a path into
 * one must be decided before it is opened — see routeFromOutside in links.ts.
 */
export function tabsFor(actor: Actor): readonly TabName[] {
  if (canAccessAdminArea(actor)) return ADMIN;
  if (canAccessEmployerArea(actor)) return EMPLOYER;
  return canAccessCandidateArea(actor) ? CANDIDATE : PUBLIC;
}

/**
 * Where the app opens for this person, and where a path into a tab they do
 * not have falls back to: the console for an admin (it is the first tab),
 * Home for everyone else.
 */
export function startPath(actor: Actor): '/admin' | '/' {
  return tabsFor(actor)[0] === 'admin' ? '/admin' : '/';
}
