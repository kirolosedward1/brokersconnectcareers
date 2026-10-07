/**
 * How the session cookies are written, by all three Supabase clients alike
 * (server components, the middleware, the browser).
 *
 * @supabase/ssr's defaults are Path=/, SameSite=Lax, 400 days and no Secure
 * flag. This site is only served over HTTPS, and the cookie that signs
 * somebody in should never travel on a request that is not, so production
 * marks it Secure. Not in development, where `next dev` on http://localhost
 * would otherwise keep nobody signed in.
 */
export const SESSION_COOKIE_OPTIONS = {
  secure: process.env.NODE_ENV === 'production',
};
