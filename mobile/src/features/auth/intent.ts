import { safeNext } from '@/lib/safe-next';

/**
 * Where somebody was headed when they were asked to sign in, and which door
 * they came through — carried through sign-up, the confirmation email and
 * onboarding exactly as the website carries it, so tapping Apply with no
 * account ends on the same listing after the account exists.
 *
 * Pure; tests/auth-intent.test.ts.
 */
export type Role = 'candidate' | 'employer';

export type AuthIntent = {
  /** A path on the website's (and so the app's) path space, already checked by safeNext. */
  next: string | null;
  /** The door's role, for onboarding to pre-select. Never decides anything for an existing account. */
  role: Role | null;
  /** Arrived from a confirmation link: onboarding says "your email is confirmed". */
  confirmed: boolean;
};

export const NO_INTENT: AuthIntent = { next: null, role: null, confirmed: false };

export function asRole(value: unknown): Role | null {
  return value === 'candidate' || value === 'employer' ? value : null;
}

/** Route parameters (all strings, or arrays when repeated) as an intent. */
export function intentFromParams(params: Record<string, string | string[] | undefined>): AuthIntent {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return {
    next: safeNext(first(params.next)),
    role: asRole(first(params.role)),
    confirmed: first(params.confirmed) === '1',
  };
}

/** An intent as route parameters, leaving out what is not there. */
export function intentParams(intent: AuthIntent): Record<string, string> {
  const params: Record<string, string> = {};
  if (intent.next) params.next = intent.next;
  if (intent.role) params.role = intent.role;
  if (intent.confirmed) params.confirmed = '1';
  return params;
}

/**
 * A landing the website would have gone to, read as an intent. The
 * confirmation email lands on /onboarding with the door's role, the
 * "confirmed" flag and the original destination in its own query — the app
 * unpacks that rather than treating onboarding as the destination, because an
 * account that has already onboarded goes straight on.
 */
export function intentFromPath(path: string | null): AuthIntent {
  const safe = safeNext(path);
  if (!safe) return NO_INTENT;

  const url = new URL(safe, 'https://app.invalid');
  if (url.pathname !== '/onboarding') return { next: safe, role: null, confirmed: false };

  return {
    next: safeNext(url.searchParams.get('next')),
    role: asRole(url.searchParams.get('role')),
    confirmed: url.searchParams.get('confirmed') === '1',
  };
}

/**
 * The address a sign-up's confirmation email comes back to — the website's
 * shape to the character (auth-form.tsx): its callback, wrapping onboarding
 * with the door's role, `confirmed=1`, and where the person was going. Opened
 * on a phone with the app, the link opens here; anywhere else, the website
 * reads the same thing and does the same.
 */
export function confirmationPath(intent: Pick<AuthIntent, 'next' | 'role'>): string {
  const onboarding = intent.role ? `/onboarding?role=${intent.role}` : '/onboarding';
  let landing = `${onboarding}${intent.role ? '&' : '?'}confirmed=1`;
  if (intent.next) landing += `&next=${encodeURIComponent(intent.next)}`;
  return `/auth/callback?next=${encodeURIComponent(landing)}`;
}
