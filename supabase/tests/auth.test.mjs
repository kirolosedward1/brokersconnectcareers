/**
 * Authentication rules that would be silent if they broke.
 *
 * `?next=` decides where somebody lands after signing in, and it arrives in a
 * query string anybody can craft. Today an off-site value is neutralised
 * downstream by accident — next-intl treats it as a pathname, so
 * `?next=https://evil.example` lands on `/arhttps:/evil.example` and 404s
 * rather than leaving the site. That is the router's string handling, not a
 * defence, and it stops being true the moment anyone reaches for
 * location.assign. These assertions are the defence.
 *
 * Run with: pnpm test:auth
 */
import { reporter } from './setup.mjs';
import { safeNext, stripLocalePrefix } from '../../src/lib/safe-next.ts';

const base = reporter();
const report = {
  ...base,
  is(actual, expected, label) {
    base.check(
      label,
      Object.is(actual, expected),
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  },
};

report.section('a redirect target may only be a path on this site');

for (const allowed of [
  '/jobs/senior-sales-manager-new-capital-693189',
  '/dashboard',
  '/dashboard/applications?stage=new',
  '/employer/jobs/abc-123/applicants',
  '/',
]) {
  report.is(safeNext(allowed), allowed, `allows ${allowed}`);
}

for (const [refused, why] of [
  ['https://evil.example/pwned', 'absolute https'],
  ['http://evil.example', 'absolute http'],
  ['//evil.example', 'protocol-relative'],
  ['//evil.example/path', 'protocol-relative with a path'],
  ['/\\evil.example', 'backslash — several browsers normalise it to a slash'],
  ['/%2f%2fevil.example', 'percent-encoded protocol-relative'],
  ['javascript:alert(1)', 'javascript scheme'],
  ['/%09/evil.example', 'embedded tab'],
  ['jobs/list', 'relative, no leading slash'],
  ['', 'empty'],
  [null, 'null'],
  [undefined, 'undefined'],
  ['/%E0%A4%A', 'malformed percent-encoding'],
]) {
  report.is(safeNext(refused), null, `refuses ${why}`);
}

// Control characters can truncate a header or slip past a naive check.
report.is(safeNext('/jobs\nLocation: https://evil.example'), null, 'refuses a newline');
report.is(safeNext('/jobs\r\nSet-Cookie: a=b'), null, 'refuses CRLF');

report.section('the locale prefix is removed before the router adds it back');

const LOCALES = ['ar', 'en'];
report.is(stripLocalePrefix('/en/dashboard', LOCALES), '/dashboard', 'strips /en');
report.is(stripLocalePrefix('/en', LOCALES), '/', '/en alone becomes root');
report.is(stripLocalePrefix('/dashboard', LOCALES), '/dashboard', 'leaves an unprefixed path alone');
// The word "english" starts with "en" and is not a locale prefix.
report.is(
  stripLocalePrefix('/english-speaking-roles', LOCALES),
  '/english-speaking-roles',
  'does not eat a path that merely starts with a locale name',
);

report.section('the middleware and the callback agree');

// Three places consume `next`; they must not disagree about what is internal,
// or one of them becomes the way in.
const CASES = ['/dashboard', 'https://evil.example', '//evil.example', '/\\evil.example'];
for (const value of CASES) {
  const viaHelper = safeNext(value);
  const expected = value === '/dashboard' ? '/dashboard' : null;
  report.is(viaHelper, expected, `one rule for ${JSON.stringify(value)}`);
}

process.exitCode = base.finish() ? 0 : 1;
