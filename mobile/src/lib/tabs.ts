import { canAccessCandidateArea, canAccessEmployerArea, type Actor } from '@/lib/permissions';

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
  | 'consultants';

const PUBLIC: readonly TabName[] = ['home', 'jobs', 'companies', 'account'];
const CANDIDATE: readonly TabName[] = ['home', 'jobs', 'applications', 'saved', 'account'];
const EMPLOYER: readonly TabName[] = ['home', 'listings', 'applicants', 'account'];

/**
 * The tab bar each person has, in order — decided by src/lib/permissions.ts,
 * as every other show-or-hide in the app is. Signed out, the public site and
 * the door. A candidate's bar is their console on the website: their
 * applications and what they saved take the places of the companies
 * directory, which is still a tap away from home (five tabs is what fits).
 * An employer's is theirs: the overview at home, their listings, their
 * applicants, and the account — where the company, its team and its billing
 * are kept.
 *
 * A tab left out is not only hidden: its screens are not in the app for that
 * person at all (a hidden native tab is a protected route), so a path into
 * one must be decided before it is opened — see routeFromOutside in links.ts.
 */
export function tabsFor(actor: Actor): readonly TabName[] {
  if (canAccessEmployerArea(actor)) return EMPLOYER;
  return canAccessCandidateArea(actor) ? CANDIDATE : PUBLIC;
}
