/**
 * What happens when a server action answers `unauthenticated`
 * (session-expired.ts).
 *
 *   pnpm test:session-recovery
 *
 * Sessions end — a refresh token expires, a password change elsewhere revokes
 * it, a tab comes back after a night. Every form that calls a server action
 * hands the result to recoverExpiredSession, which either leaves it alone (any
 * other outcome is the form's to show) or sends the person to sign in with a
 * way back to the page they were on. That way back is read from the address
 * bar, whose query string anybody can write in a link, and handed to a
 * redirect — so it goes through safeNext like every other `next`.
 */
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { recoverExpiredSession } = await import('../src/lib/session-expired.ts');

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Runs recovery as if the browser were on `href`; returns what it did.
 *
 * The path and query are split by hand rather than with `new URL`, which
 * would read `//evil.example/` as a host: on the site itself, a browser at
 * `https://www.brokersconnect.net//evil.example/` reports exactly that as its
 * pathname, still percent-encoded.
 */
function at(href, result, locale = 'ar') {
  const q = href.indexOf('?');
  const pathname = q === -1 ? href : href.slice(0, q);
  const search = q === -1 ? '' : href.slice(q);
  const assigned = [];
  globalThis.window = {
    location: { pathname, search, assign: (to) => assigned.push(to) },
  };
  try {
    const tookOver = recoverExpiredSession(result, locale);
    return { tookOver, assigned };
  } finally {
    delete globalThis.window;
  }
}

/** The `next` a sign-in redirect carries back. */
function nextOf(target) {
  return new URL(target, 'https://www.brokersconnect.net').searchParams.get('next');
}

const EXPIRED = { ok: false, error: 'unauthenticated' };

console.log('\n— what it leaves alone');
{
  for (const [label, result] of [
    ['a success', { ok: true }],
    ['a validation error', { ok: false, error: 'invalid' }],
    ['a database error', { ok: false, error: 'server_error' }],
    ['a rate limit', { ok: false, error: 'rate_limited' }],
    ['a refusal for somebody signed in', { ok: false, error: 'forbidden' }],
  ]) {
    const r = at('/employer/jobs', result);
    check(`${label}: not taken over, no navigation`, r.tookOver === false && r.assigned.length === 0);
  }
}

console.log('\n— an expired session');
{
  const r = at('/jobs/sales-new-cairo-123456/apply?ref=whatsapp', EXPIRED);
  check('taken over, so the form stops', r.tookOver === true);
  check('exactly one navigation', r.assigned.length === 1, JSON.stringify(r.assigned));
  const target = r.assigned[0] ?? '';
  check('to the sign-in page, saying why', target.startsWith('/sign-in?') && target.includes('error=session_expired'), target);
  check('carrying the page and its query back', nextOf(target) === '/jobs/sales-new-cairo-123456/apply?ref=whatsapp', nextOf(target));

  const english = at('/en/dashboard/profile', EXPIRED, 'en').assigned[0] ?? '';
  check('in English, the English sign-in page', english.startsWith('/en/sign-in?'), english);
  check('with the locale prefix stripped from `next`, not doubled on the way back', nextOf(english) === '/dashboard/profile', nextOf(english));

  const home = at('/', EXPIRED).assigned[0] ?? '';
  check('from the home page, back to the home page', nextOf(home) === '/', home);
}

console.log('\n— a crafted address cannot turn it into a redirect off the site');
{
  // A link can put anything after the site's own `/`, and a doubled slash,
  // a backslash or a control character survives into pathname — as is, or
  // percent-encoded, which a browser decodes on the way back out.
  for (const href of [
    '//evil.example/',
    '/%2f%2fevil.example',
    '/%2F%2Fevil.example/jobs',
    '/%5cevil.example',
    '/\\evil.example',
    '/%09/evil.example',
  ]) {
    const r = at(href, EXPIRED);
    const target = r.assigned[0] ?? '';
    check(`${href}: signs in on this site, and comes back to the home page instead`,
      r.tookOver && target.startsWith('/sign-in?') && nextOf(target) === '/', `${target} → next=${nextOf(target)}`);
  }
  // Encoded, but harmless once decoded: an ordinary internal path is kept.
  const plain = at('/jobs%2Fsales', EXPIRED).assigned[0] ?? '';
  check('an encoded path that decodes to an internal one is kept', nextOf(plain) === '/jobs%2Fsales', plain);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
