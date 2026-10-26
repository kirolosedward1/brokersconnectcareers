/**
 * The bell's "see all".
 *
 * The feed already lives at /notifications, for every signed-in role. This
 * path is the one the header names. Employers and admins may open it: the
 * audience is authenticated, the same exception /dashboard/account is, and
 * the page itself asks only for a profile.
 */
export { default, generateMetadata } from '../../notifications/page';
