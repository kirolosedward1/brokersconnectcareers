import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE = (__ENV.BASE_URL || '').replace(/\/$/, '');

export function guard() {
  if (!BASE) fail('set BASE_URL to a preview or staging deployment');
  if (/brokersconnect\.net/i.test(BASE) && __ENV.I_KNOW_THIS_IS_NOT_PRODUCTION !== '1') {
    fail('refusing to run against production');
  }
}

/** Signs in through Supabase Auth the way the browser does, and returns cookies the site accepts. */
export function signIn(email, password) {
  const url = __ENV.SUPABASE_URL;
  const key = __ENV.SUPABASE_ANON_KEY;
  if (!url || !key) fail('set SUPABASE_URL and SUPABASE_ANON_KEY for authenticated scenarios');

  const res = http.post(
    `${url}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    { headers: { apikey: key, 'content-type': 'application/json' }, tags: { name: 'auth:sign-in' } },
  );
  check(res, { 'signed in': (r) => r.status === 200 });
  if (res.status !== 200) return null;

  const session = res.json();
  // @supabase/ssr stores the session as a base64url JSON cookie named
  // sb-<ref>-auth-token; the server client reads it back.
  const ref = new URL(url).hostname.split('.')[0];
  const encoded = 'base64-' + btoa(JSON.stringify(session)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jar = http.cookieJar();
  jar.set(BASE, `sb-${ref}-auth-token`, encoded);
  return session;
}

export function page(path, name) {
  const res = http.get(`${BASE}${path}`, { tags: { name: name || path.split('?')[0] } });
  check(res, { [`${name || path} 200`]: (r) => r.status === 200 });
  return res;
}
