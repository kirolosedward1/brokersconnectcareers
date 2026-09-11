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
  ok(condition, label) {
    base.check(label, Boolean(condition));
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


report.section('nothing hands the browser a path it has not checked');

/*
  Landing after sign-in, sign-out, onboarding and account deletion are document
  navigations now, because a client push raced the refresh beside it and left
  people on a blank page. That trade moves a burden: next-intl's router treated
  a hostile `next` as a pathname and neutralised it by accident, and
  `window.location.assign` does not.

  It was already wrong once. `/onboarding?next=//evil.example` was checked with
  `startsWith('/')`, which a protocol-relative URL satisfies, and the day the
  last hop became a real navigation that became an open redirect off the site.

  So: two rules, read off the source rather than remembered. Every assign takes
  either a literal path or a value from a file that validates, and there is
  exactly one definition of what "internal" means.
*/
{
  const { readdirSync: rd, readFileSync: rf } = await import('node:fs');
  const { join: jn, dirname: dnm } = await import('node:path');
  const { fileURLToPath: fu } = await import('node:url');

  const SRC = jn(dnm(fu(import.meta.url)), '../../src');

  const walk = (dir) =>
    rd(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(jn(dir, e.name)) : /\.tsx?$/.test(e.name) ? [jn(dir, e.name)] : [],
    );

  /** Source with comments removed, so prose about a rule is not mistaken for it. */
  const code = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const files = walk(SRC);
  report.ok(files.length > 100, `read ${files.length} source files`);

  let assigns = 0;
  for (const file of files) {
    const text = code(rf(file, 'utf8'));
    for (const match of text.matchAll(/window\.location\.assign\(([^;]*?)\);/g)) {
      assigns += 1;
      const argument = match[1];
      const literal = /localeHref\(\s*locale\s*,\s*'\/[^']*'\s*\)/.test(argument);
      report.ok(
        literal || text.includes('safeNext('),
        `${file.slice(SRC.length + 1)} validates what it navigates to`,
      );
    }
  }
  report.ok(assigns >= 6, `found ${assigns} document navigations to check`);

  const loose = files.filter(
    (file) =>
      !file.endsWith('safe-next.ts') && /startsWith\(['"]\//.test(code(rf(file, 'utf8'))),
  );
  report.is(
    loose.map((f) => f.slice(SRC.length + 1)).join(', '),
    '',
    'only safe-next.ts decides what an internal path is',
  );
}

report.section('no form can submit itself before the page is ready');

/*
  A `<form onSubmit={...}>` with no `action` renders as `<form>` — no action,
  no method — and a browser submitting that does a GET to the same URL with
  every field in the query string. React's handler is what stops it, and
  React's handler does not exist until the page hydrates.

  On /sign-in that window put an email and a password into location.href, and
  from there into browser history, into the Referer header of every same-origin
  request that followed, and into the platform's access log — while the
  sign-in itself silently did nothing. Read straight off the served HTML: the
  form had no action, the submit button was enabled, and the password field was
  right there beside it.

  SubmitButton renders disabled until it has mounted, which also covers Enter
  in a text field: the HTML spec skips implicit submission when a form's
  default button is disabled. This asserts every such form uses it.
*/
{
  const { readdirSync: rdir, readFileSync: rfile } = await import('node:fs');
  const { join: pjoin, dirname: pdir } = await import('node:path');
  const { fileURLToPath: furl2 } = await import('node:url');

  const SRC = pjoin(pdir(furl2(import.meta.url)), '../../src');

  const walk = (dir) =>
    rdir(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(pjoin(dir, e.name)) : /\.tsx$/.test(e.name) ? [pjoin(dir, e.name)] : [],
    );

  /*
    The keyword search is the exception, and a real one: its field is named `q`
    and the page reads `q`, so the native GET this rule exists to prevent is
    exactly the right fallback there. Disabling that button would remove a
    search that works without JavaScript.
  */
  const PROGRESSIVE = new Set(['components/jobs/job-filters.tsx']);

  const offenders = [];
  let checked = 0;

  /*
    Comments blanked, not removed, so a docblock quoting the very pattern this
    rule forbids is not read as an instance of it — which is what happened
    first: the check flagged SubmitButton's own explanation of the bug.
  */
  const strip = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
      .replace(/^(\s*)\/\/.*$/gm, '$1');

  for (const file of walk(SRC)) {
    const source = rfile(file, 'utf8');
    if (!/^['"]use client['"]/m.test(source)) continue;
    // The component that implements the rule is the one place a plain
    // submit-typed Button belongs.
    if (file.endsWith('ui/submit-button.tsx')) continue;
    const text = strip(source);

    // Every <form …> tag in the file, with its attributes.
    for (const tag of text.matchAll(/<form\b[^>]*>/g)) {
      if (!/onSubmit=/.test(tag[0])) continue;
      if (/\baction=/.test(tag[0])) continue; // has a real destination
      checked += 1;

      const relative = file.slice(SRC.length + 1);
      if (PROGRESSIVE.has(relative)) continue;

      if (/<Button\s+type="submit"/.test(text)) {
        offenders.push(`${relative} still has a plain <Button type="submit">`);
      } else if (!/<SubmitButton\b/.test(text)) {
        offenders.push(`${relative} has no SubmitButton`);
      }
    }
  }

  report.ok(checked > 10, `found ${checked} client-only forms`);
  report.is(offenders.join('; '), '', 'each one disables its submit until hydrated');
}

report.section('every private route is actually listed as private');

// Two hand-maintained lists of (app) routes have now drifted out of date, and
// both times the symptom was subtle rather than a hole: a redirect that worked
// but lost where the visitor was going. This reads the routes off disk so the
// list cannot silently fall behind a third time.
const { readdirSync, readFileSync: read } = await import('node:fs');
const { join: j, dirname: dn } = await import('node:path');
const { fileURLToPath: furl } = await import('node:url');

const ROOT = j(dn(furl(import.meta.url)), '../..');
const appGroups = readdirSync(j(ROOT, 'src/app/[locale]/(app)'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => `/${e.name}`);

const middleware = read(j(ROOT, 'src/middleware.ts'), 'utf8');
const listed = middleware.match(/const PROTECTED = \[([^\]]*)\]/)?.[1] ?? '';
const protectedPrefixes = [...listed.matchAll(/'([^']+)'/g)].map((m) => m[1]);

report.ok(appGroups.length > 0, `found ${appGroups.length} route groups under (app)`);

for (const group of appGroups) {
  report.ok(
    protectedPrefixes.includes(group),
    `${group} is in the middleware's PROTECTED list`,
  );
}

// /onboarding is outside (app) and still has to be there.
report.ok(protectedPrefixes.includes('/onboarding'), '/onboarding is protected');

/*
  The demo accounts are not offered to the public.

  Their password is in the client bundle by design — a button that signs
  anyone in has published it. What must not happen is that button reaching a
  deployment with live listings: it was on production, offering the inbox of
  a verified company, applicants' phone numbers and CVs included, to anyone
  who tapped it. The gate is a build-time flag; this checks the gate is on the
  button, that the flag is documented, and that it is not set for Vercel.
*/
{
  const { existsSync } = await import('node:fs');
  const form = read(j(ROOT, 'src/components/auth/auth-form.tsx'), 'utf8');
  report.ok(
    /process\.env\.NEXT_PUBLIC_DEMO_LOGIN === 'true'/.test(form),
    'the demo sign-in reads NEXT_PUBLIC_DEMO_LOGIN',
  );
  report.ok(
    /mode === 'sign-in' && DEMO_LOGIN \?/.test(form),
    'the demo buttons render only behind that flag',
  );
  const example = read(j(ROOT, '.env.example'), 'utf8');
  report.ok(/^# NEXT_PUBLIC_DEMO_LOGIN=true/m.test(example), '.env.example documents the flag');
  const vercelEnv = j(ROOT, '.env.vercel.local');
  const vercel = existsSync(vercelEnv) ? read(vercelEnv, 'utf8') : '';
  report.ok(
    !/^\s*NEXT_PUBLIC_DEMO_LOGIN\s*=\s*true/m.test(vercel),
    'the Vercel env file does not enable it',
  );
}

/*
  A session in the URL fragment is spent, not ignored.

  Supabase's implicit-flow links — dashboard "send recovery", "send magic
  link", or any recover call without a code challenge — land on the Site URL
  with the session in the fragment, which no server code can see. A confirmed
  sign-up sat on the home page, signed out, with its tokens in the address bar.
  The rescue must be mounted on every page, must strip the fragment before
  anything else, and must only ever navigate to fixed paths.
*/
{
  const layout = read(j(ROOT, 'src/app/[locale]/layout.tsx'), 'utf8');
  report.ok(/<FragmentSession \/>/.test(layout), 'the root layout mounts FragmentSession');
  const rescue = read(j(ROOT, 'src/components/auth/fragment-session.tsx'), 'utf8');
  const strip = rescue.indexOf('history.replaceState');
  const store = rescue.indexOf('setSession(');
  report.ok(strip !== -1 && store !== -1 && strip < store, 'the fragment is wiped before the session is stored');
  report.ok(!/window\.location\.(assign|href\s*=)/.test(rescue), 'the rescue navigates through the router, to literal paths only');
  const signIn = read(j(ROOT, 'src/app/[locale]/sign-in/page.tsx'), 'utf8');
  report.ok(/link_expired/.test(signIn) && /missing_code/.test(signIn) && /exchange_failed/.test(signIn), 'the sign-in page explains all three link failures');
}

/*
  An unconfirmed sign-in offers the mail again, and a confirmation is
  acknowledged where it lands. Both are one-line facts about the source that a
  refactor could quietly lose.
*/
{
  const form = read(j(ROOT, 'src/components/auth/auth-form.tsx'), 'utf8');
  report.ok(/setUnconfirmed\(signInError\.code === 'email_not_confirmed'/.test(form), 'sign-in detects the unconfirmed-email refusal');
  report.ok(/error && unconfirmed && mode === 'sign-in'/.test(form), 'and offers the confirmation mail again right there');
  report.ok(/confirmed=1/.test(form) && (form.match(/confirmationRedirect\(\)/g) || []).length >= 3, 'every confirmation link the app requests lands with the confirmed flag');
  const rescue = read(j(ROOT, 'src/components/auth/fragment-session.tsx'), 'utf8');
  report.ok(/confirmed: '1'/.test(rescue), 'the fragment rescue carries the flag for a sign-up too');
  const onboarding = read(j(ROOT, 'src/app/[locale]/onboarding/page.tsx'), 'utf8');
  report.ok(/confirmed === '1'/.test(onboarding), 'onboarding shows the acknowledgement');
}

/*
  The sign-up door's answer is not asked again.

  The role chosen at /sign-up/employer travels in the confirmation link and in
  user metadata, and onboarding shows one line with a "change" control instead
  of the two cards whenever it knows the answer.
*/
{
  const form = read(j(ROOT, 'src/components/auth/auth-form.tsx'), 'utf8');
  report.ok(/data: \{ role: audience \}/.test(form), 'sign-up stores the door\'s role in user metadata');
  report.ok((form.match(/emailRedirectTo: confirmationRedirect\(\)/g) || []).length === 3, 'sign-up and both resends use the same confirmation landing, role included');
  const viewer = read(j(ROOT, 'src/lib/auth.ts'), 'utf8');
  report.ok(/suggestedRole/.test(viewer), 'getViewer exposes the stored role as a suggestion');
  const onboarding = read(j(ROOT, 'src/components/auth/onboarding-form.tsx'), 'utf8');
  report.ok(/roleSettled \? \(/.test(onboarding) && /roleChange/.test(onboarding), 'onboarding skips the role question when it is known, with a way to change it');
}

process.exitCode = base.finish() ? 0 : 1;
