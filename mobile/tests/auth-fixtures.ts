import type { MobileConfig } from '@/lib/mobile-api/reads';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';
import { company } from './fixtures';

/*
  Supabase Auth's side of a sign-in, as GoTrue answers it: a user, a session
  whose access token is a real (unsigned) JWT — supabase-js reads the
  assurance level out of it — and a profile row for once onboarding is done.
*/

export const SITE = process.env.EXPO_PUBLIC_SITE_URL as string;

export const USER_ID = '8b7c7f1e-0000-4000-8000-000000000001';

type Factor = { id: string; factor_type: 'totp'; status: 'verified' | 'unverified'; created_at: string; updated_at: string };

export type AuthUser = {
  id: string;
  aud: string;
  role: string;
  email: string;
  email_confirmed_at: string | null;
  app_metadata: { provider: string; providers: string[] };
  user_metadata: Record<string, unknown>;
  identities: { id: string; user_id: string; provider: string; identity_data: Record<string, unknown> }[];
  factors?: Factor[];
  created_at: string;
  updated_at: string;
};

export function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'sara@example.com',
    email_confirmed_at: '2026-09-01T10:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [{ id: USER_ID, user_id: USER_ID, provider: 'email', identity_data: { email: 'sara@example.com' } }],
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-28T10:00:00Z',
    ...overrides,
  };
}

export const totpFactor: Factor = {
  id: 'factor-1',
  factor_type: 'totp',
  status: 'verified',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

/** Base64url of an ASCII string (all a test token holds). */
const base64url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encoded = (value: unknown) => base64url(JSON.stringify(value));

export function authSession(user: AuthUser, aal: 'aal1' | 'aal2' = 'aal1') {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    aal,
    amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }],
    session_id: `session-${aal}`,
    iat: now,
    exp: now + 3600,
  };
  return {
    // Unsigned in all but name: the app never checks a signature, Supabase does.
    access_token: `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded(claims)}.${base64url('signature')}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `refresh-${aal}`,
    user,
  };
}

export const profile: ProfileRow = {
  id: USER_ID,
  role: 'candidate',
  full_name: 'سارة عادل',
  whatsapp_phone: '+201001234567',
  avatar_url: null,
  locale: 'ar',
  notify_applications: true,
  notify_status: true,
  notify_digest: true,
  notify_applicant_digest: false,
  approval_status: 'approved',
  approved_at: '2026-09-01T10:00:00Z',
  created_at: '2026-09-01T10:00:00Z',
};

/** A company this account owns, for the deletion that cannot go ahead. */
export const ownedCompany: CompanyRow = { ...company, owner_id: USER_ID };

export function mobileConfig(overrides: Partial<MobileConfig> = {}): MobileConfig {
  return {
    minAppVersion: '1.0.0',
    turnstileSiteKey: null,
    providers: { google: false, apple: false },
    englishEnabled: false,
    billingEnabled: false,
    supportEmail: 'help@brokersconnect.net',
    ...overrides,
  };
}
