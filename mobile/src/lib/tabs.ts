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
// The console and the account, nothing of the public site's: an admin's app
// is the admin console. Home's screens stay in the app (its button is hidden,
// and `/` opens the console), and a listing, a company or a consultant the
// console points at opens inside the Admin tab (links.ts).
const ADMIN: readonly TabName[] = ['admin', 'account'];
const ADMIN_EMPLOYER: readonly TabName[] = ['home', 'listings', 'applicants', 'admin', 'account'];

/**
 * The tab bar each person has, in order — decided by src/lib/permissions.ts,
 * as every other show-or-hide in the app is. Signed out, the public site and
 * the door. A candidate's bar is their console on the website: their
 * applications and what they saved take the places of the companies
 * directory, which is still a tap away from home (five tabs is what fits).
 * An employer's is theirs: the overview at home, their listings, their
 * applicants, the consultant directory, and the account — where the company,
 * its team and its billing are kept. An admin's has the console (the website's
 * /admin console) and the account, and nothing of the public site's — or,
 * for an admin who also runs a company, the console in the directory's place
 * beside that company's own; the directory and the shortlist then open inside
 * the Admin tab ((consultants,admin) in the routes, links.ts).
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
  if (canAccessAdminArea(actor)) return canAccessEmployerArea(actor) ? ADMIN_EMPLOYER : ADMIN;
  if (canAccessEmployerArea(actor)) return EMPLOYER;
  return canAccessCandidateArea(actor) ? CANDIDATE : PUBLIC;
}
