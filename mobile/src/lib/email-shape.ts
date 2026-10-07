/**
 * An email address's shape, checked before anything is sent: something@
 * something.something with no spaces. The server has the last word (Supabase
 * Auth, or the website's zod `email()`); this only saves a round trip that
 * could only come back as "not an address".
 */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
