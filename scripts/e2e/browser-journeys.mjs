/**
 * The website's journeys in a real browser: the forms a person fills in, the
 * redirects between them, the cookies that carry the session — and, after
 * each, what the database holds, read directly over DATABASE_URL.
 *
 *   SITE_URL=http://localhost:3000 SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=… DATABASE_URL=postgres://… DEMO_PASSWORD=… \
 *   [CHROMIUM_PATH=/path/to/chrome] [MAIL_DIR=…] node scripts/e2e/browser-journeys.mjs
 *
 * ADMIN_MFA_REQUIRED=true (on this process and on the website) is the run
 * where an admin with no authenticator is sent to enrol. Without it the
 * console opens, and that is what the admin section below expects.
 * BROWSER_JOURNEY=admin-mfa runs only that enrolment section, and refuses
 * to start unless ADMIN_MFA_REQUIRED=true.
 *
 * Chrome: CHROMIUM_PATH if set, otherwise the installed Google Chrome
 * (GitHub's Ubuntu runners have it). MAIL_DIR, a folder an SMTP sink writes
 * each message into as a file, turns on the password-reset journey, which has
 * to read the link out of the email; without it that journey is skipped.
 *
 * journeys.mjs and edge-journeys.mjs send what the app sends. This is the
 * other half: that the website's own pages get a person there — sign up,
 * onboarding, applying, the account page, signing out and back in, a reset
 * password, the admin's approval — on a slow line, after a session that died
 * underneath the page, and with the button pressed twice. Never against
 * production: it refuses to.
 */
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

const SITE = required('SITE_URL').replace(/\/$/, '');
const SUPABASE = required('SUPABASE_URL').replace(/\/$/, '');
const ANON = required('SUPABASE_ANON_KEY');
const PASSWORD = required('DEMO_PASSWORD');
const DATABASE_URL = required('DATABASE_URL');
const MAIL_DIR = process.env.MAIL_DIR || '';

for (const url of [SITE, SUPABASE, DATABASE_URL]) {
  if (url.includes('hiwdhicwsohbipxzazmb') || url.includes('brokersconnect.net')) {
    console.error('Refusing to run journeys against production.');
    process.exit(1);
  }
}

// Before Chrome or the database: the short run is only the enrolment path.
if (process.env.BROWSER_JOURNEY === 'admin-mfa' && process.env.ADMIN_MFA_REQUIRED !== 'true') {
  console.error('BROWSER_JOURNEY=admin-mfa needs ADMIN_MFA_REQUIRED=true, on the website as well as here.');
  process.exit(1);
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  return value;
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const sql = async (text, params = []) => (await db.query(text, params)).rows;

let pass = 0;
let fail = 0;
function check(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
  return Boolean(condition);
}
function section(title) {
  console.log(`\n— ${title}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' },
);
/** A fresh browser profile: its own cookies, as a second device would have. */
async function device() {
  const context = await browser.newContext({ locale: 'ar-EG', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => {
    const where = new URL(page.url()).pathname;
    /*
      A hydration mismatch (React #418, #423, #425) is said, not failed: one
      was seen once on the employer console and not again in sixty-odd
      repetitions of the same steps, and the page worked around it. Where it
      happened is printed so a second sighting can be traced. Anything else a
      page throws fails the journey.
    */
    if (/Minified React error #(418|423|425)\b/.test(error.message)) {
      console.log(`  WARN  hydration mismatch on ${where}: ${error.message.slice(0, 120)}`);
      return;
    }
    errors.push(`${where}: ${error.message}`);
  });
  return { context, page, errors };
}

const path = (page) => new URL(page.url()).pathname;
/** Waits for the address bar to show `pattern`, and says where it ended up if it never does. */
async function landsOn(page, pattern, timeout = 15000) {
  try {
    await page.waitForURL((url) => pattern.test(url.pathname + url.search), { timeout });
    return true;
  } catch {
    return false;
  }
}
const submit = (page) => page.locator('form button[type="submit"]').last();

// The apply form's own words for success, from the catalogue the site renders.
const CATALOGUE = JSON.parse(readFileSync(new URL('../../messages/ar.json', import.meta.url), 'utf8'));
const APPLY = CATALOGUE.apply;
const JOBS = CATALOGUE.jobs;
/**
 * Whether the apply form shows that it went: its green panel, or the server's
 * confirmation at ?applied=1 that the form hands over to straight after.
 */
async function showsApplied(page, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (/applied=1/.test(page.url())) return true;
    if (await page.getByText(APPLY.success, { exact: false }).count().catch(() => 0)) return true;
    await sleep(250);
  }
  return false;
}

/** The six digits an authenticator app shows for a base32 secret now (RFC 6238). */
function totp(secret, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const mac = createHmac('sha1', key).update(counter).digest();
  const at = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function signInThroughForm(page, email, password = PASSWORD) {
  await page.goto(`${SITE}/sign-in`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await submit(page).click();
}

const ADMIN_ROUTES = ['/admin', '/admin/jobs', '/admin/users', '/admin/companies', '/admin/reports', '/admin/audit', '/admin/operations'];

/** The console's pages, then one waiting employer when the seed has one. */
async function consoleOpens(page, lead) {
  for (const where of ADMIN_ROUTES) {
    const opened = await page.goto(`${SITE}${where}`, { waitUntil: 'load' });
    check(`${lead} ${where} opens`, opened?.status() === 200 && path(page) === where, `${opened?.status()} ${page.url()}`);
  }
  const waiting = await sql(
    "select id from profiles where role = 'employer' and approval_status = 'pending' order by created_at desc limit 1",
  );
  if (waiting.length) {
    const opened = await page.goto(`${SITE}/admin/users/${waiting[0].id}`, { waitUntil: 'load' });
    check('a waiting employer opens in the console', opened?.status() === 200 && /\/admin\/users\//.test(path(page)), `${opened?.status()} ${page.url()}`);
  }
}

/**
 * ADMIN_MFA_REQUIRED is unset. An admin with no authenticator is let straight
 * into the console. The enrolment button is not on this page: it is drawn
 * when the console sends them to /dashboard/account?mfa=required, which is
 * the other run.
 */
async function adminConsoleOpens() {
  section('the admin: the console opens without two-step sign-in');
  const adminId = (await sql("select id from auth.users where email = 'admin@demo.test'"))[0]?.id;
  await sql('delete from auth.mfa_factors where user_id = $1', [adminId]);
  const { page, context, errors } = await device();
  await signInThroughForm(page, 'admin@demo.test');
  check('an admin with no second factor reaches the console', await landsOn(page, /\/admin$/), page.url());
  await consoleOpens(page, 'without a second factor the console\'s');
  check('the console threw no script errors', errors.length === 0, errors.slice(0, 3));
  await context.close();
}

/**
 * ADMIN_MFA_REQUIRED=true. The console sends an admin with no authenticator
 * to enrol, the same button as before the requirement defaulted to off.
 * Once a factor exists, the next sign-in is asked for the code whether or
 * not the requirement is on — this run is where that is exercised.
 */
async function adminWithMfaRequired() {
  section('the admin: two-step verification, then the console');
  const adminId = (await sql("select id from auth.users where email = 'admin@demo.test'"))[0]?.id;
  // A clean start: a factor a previous run left has a secret this run never saw.
  await sql('delete from auth.mfa_factors where user_id = $1', [adminId]);
  const { page, context, errors } = await device();
  await signInThroughForm(page, 'admin@demo.test');
  const sentToEnrol = check(
    'an admin with no second factor is sent to set one up',
    await landsOn(page, /\/dashboard\/account\?mfa=required/),
    page.url(),
  );
  if (sentToEnrol) {
    // The button is on this page because of ?mfa=required. The account hub
    // without that query does not draw it.
    await page.locator('button').filter({ hasText: 'فعّل التحقق بخطوتين' }).click();
    const secret = (await page.locator('code[dir="ltr"]').first().textContent({ timeout: 15000 }))?.trim() ?? '';
    check('enrolling shows a secret for the authenticator app', /^[A-Z2-7]{16,}$/.test(secret), secret);
    await page.fill('input[name="code"]', '000000');
    await submit(page).click();
    await sleep(1500);
    check('a wrong code is refused', (await sql("select 1 from auth.mfa_factors where user_id = $1 and status = 'verified'", [adminId])).length === 0);
    await page.fill('input[name="code"]', totp(secret));
    await submit(page).click();
    await sleep(2500);
    check('the right code verifies the factor', (await sql("select 1 from auth.mfa_factors where user_id = $1 and status = 'verified'", [adminId])).length === 1);

    await consoleOpens(page, "at aal2 the console's");
    check('the console threw no script errors', errors.length === 0, errors.slice(0, 3));

    // A new session on another browser starts at aal1: it is asked for the code.
    const second = await device();
    await signInThroughForm(second.page, 'admin@demo.test');
    check('the next sign-in is asked for the code before the console', await landsOn(second.page, /\/dashboard\/account\?mfa=challenge/), second.page.url());
    // A code is good once: GoTrue refuses one already used, as the enrolment
    // just did with this window's. The admin types the next one, as anybody
    // whose app has moved on would.
    await sleep(30_000 - (Date.now() % 30_000) + 1000);
    await second.page.fill('input[name="code"]', totp(secret));
    await submit(second.page).click();
    await sleep(2500);
    const afterCode = await second.page.goto(`${SITE}/admin`, { waitUntil: 'load' });
    check('and with it, the console opens', afterCode?.status() === 200 && path(second.page) === '/admin', `${afterCode?.status()} ${second.page.url()}`);
    await second.context.close();
  }
  await context.close();
  // Leave the demo admin as it was found, for the API journeys that sign in as it.
  await sql('delete from auth.mfa_factors where user_id = $1', [adminId]);
}

// The enrolment path on its own, against a website started with the requirement on.
if (process.env.BROWSER_JOURNEY === 'admin-mfa') {
  await adminWithMfaRequired();
  await browser.close();
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
section('a visitor: the public pages, and the empty ones');
{
  const { page, errors, context } = await device();
  for (const [where, label] of [
    ['/', 'the home page'],
    ['/jobs', 'the board'],
    ['/companies', 'the companies directory'],
    ['/agents', 'the consultant directory'],
    ['/blog', 'the blog'],
    ['/privacy', 'the privacy policy'],
    ['/terms', 'the terms'],
  ]) {
    const response = await page.goto(`${SITE}${where}`);
    check(`${label} opens (${where})`, response?.status() === 200, `${response?.status()}`);
  }
  const live = (await sql("select slug from jobs where status = 'active' and expires_at > now() order by published_at desc limit 1"))[0];
  const job = await page.goto(`${SITE}/jobs/${live.slug}`);
  check('a live listing opens', job?.status() === 200);
  const missing = await page.goto(`${SITE}/jobs/no-such-listing-browser`);
  check('a listing that does not exist is a 404', missing?.status() === 404, `${missing?.status()}`);
  const nothing = await page.goto(`${SITE}/jobs?q=${encodeURIComponent('لا توجد وظيفة بهذا الاسم xyzzy')}`);
  check('a search that finds nothing still answers 200', nothing?.status() === 200);
  check('and draws no listing cards', (await page.locator('main article').count()) === 0, `${await page.locator('main article').count()} cards`);
  const guarded = await page.goto(`${SITE}/dashboard`);
  check('a signed-out visitor sent to the dashboard is asked to sign in', /\/sign-in/.test(path(page)), `${guarded?.status()} ${page.url()}`);
  check('the public pages threw no script errors', errors.length === 0, errors.slice(0, 3));
  await context.close();
}

// ---------------------------------------------------------------------------
section('somebody new: sign up, onboarding with a mistake, and the dashboard');
const email = `e2e-browser-${Date.now()}@example.com`;
let password = `E2e-${randomUUID()}`;
let userId = null;
{
  const { page, context, errors } = await device();
  await page.goto(`${SITE}/sign-up`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="passwordConfirm"]', `${password}-different`);
  await submit(page).click();
  await sleep(1500);
  check('passwords that differ keep them on the form', /\/sign-up/.test(path(page)));
  check('and make no account', (await sql('select 1 from auth.users where email = $1', [email])).length === 0);

  await page.fill('input[name="passwordConfirm"]', password);
  // Twice, as an impatient finger does.
  await submit(page).click();
  await submit(page).click({ timeout: 2000 }).catch(() => {});
  check('a new account lands on onboarding', await landsOn(page, /\/onboarding/), page.url());
  const accounts = await sql('select id from auth.users where email = $1', [email]);
  check('one account exists for the address', accounts.length === 1, accounts);
  userId = accounts[0]?.id;

  await page.locator('input[name="role"][value="candidate"]').check({ force: true });
  await page.fill('input[name="fullName"]', 'مستخدم المتصفح');
  await page.fill('input[name="whatsapp"]', '0100 123 456'); // a digit short
  await page.locator('input[name="visibility"]').first().check({ force: true });
  await page.locator('input[name="agreed"]').check({ force: true });
  await submit(page).click();
  await sleep(2000);
  check('a short phone keeps them on onboarding', /\/onboarding/.test(path(page)), page.url());
  check('with the phone field marked', (await page.locator('[aria-invalid="true"]').count()) > 0 || (await page.locator('[role="alert"]').count()) > 0);
  check('and no profile is made', (await sql('select 1 from profiles where id = $1', [userId])).length === 0);

  await page.fill('input[name="whatsapp"]', '01001234567');
  await submit(page).click();
  check('corrected, onboarding goes on to the dashboard', await landsOn(page, /\/dashboard/), page.url());
  const [profile] = await sql('select role, whatsapp_phone, full_name from profiles where id = $1', [userId]);
  check('the profile holds what was typed, the number normalised', profile?.role === 'candidate' && profile?.whatsapp_phone === '+201001234567', profile);
  check('and the agreement is recorded', (await sql('select 1 from policy_acceptances where user_id = $1', [userId])).length === 1);

  for (const [where, label] of [
    ['/dashboard', 'the dashboard'],
    ['/dashboard/applications', 'the applications page'],
    ['/dashboard/saved', 'the saved page'],
    ['/dashboard/profile', 'the profile page'],
    ['/dashboard/account', 'the account page'],
    ['/notifications', 'the notifications page'],
  ]) {
    const response = await page.goto(`${SITE}${where}`);
    check(`${label} opens empty for a new account`, response?.status() === 200 && path(page) === where, `${response?.status()} ${page.url()}`);
  }
  const back = await page.goto(`${SITE}/onboarding`);
  check('an onboarded account sent to onboarding again is sent on', !/\/onboarding/.test(path(page)), `${back?.status()} ${page.url()}`);
  check('none of it threw a script error', errors.length === 0, errors.slice(0, 3));
  await context.close();
}

// ---------------------------------------------------------------------------
section('applying on a slow line, pressing send twice');
{
  const { page, context, errors } = await device();
  await signInThroughForm(page, email, password);
  check('they sign back in', await landsOn(page, /\/dashboard/), page.url());

  const target = (await sql(
    `select j.slug, j.id, j.title_ar from jobs j
      where j.status = 'active' and j.expires_at > now()
        and not exists (select 1 from applications a where a.job_id = j.id and a.candidate_id = $1)
      order by j.published_at desc limit 1`,
    [userId],
  ))[0];
  // Every request held for 600 ms and the line throttled, as a phone on a weak signal is.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 600, downloadThroughput: 50_000, uploadThroughput: 20_000 });

  await page.goto(`${SITE}/jobs/${target.slug}/apply`, { timeout: 60000 });
  await page.fill('input[name="whatsapp"]', '123');
  await submit(page).click();
  await sleep(2500);
  check('a bad phone on the apply form is refused there', (await sql('select 1 from applications where candidate_id = $1 and job_id = $2', [userId, target.id])).length === 0);

  await page.fill('input[name="whatsapp"]', '01001234567');
  await page.fill('textarea[name="note"]', 'متاح فورًا (browser)');
  await submit(page).click();
  await submit(page).click({ timeout: 1500 }).catch(() => {});
  check('on a slow line the application still goes through', await showsApplied(page, 60000), page.url());
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const rows = await sql('select status, note from applications where candidate_id = $1 and job_id = $2', [userId, target.id]);
  check('exactly one application, new, with the note', rows.length === 1 && rows[0].status === 'new' && rows[0].note?.includes('browser'), rows);

  await page.goto(`${SITE}/dashboard/applications`);
  check('the applications page lists it, by its title', (await page.locator('main').innerText()).includes(target.title_ar), target.title_ar);
  check('no script errors along the way', errors.length === 0, errors.slice(0, 3));

  // Offline, then back: the page does not pretend it sent anything.
  const other = (await sql(
    `select j.slug, j.id from jobs j
      where j.status = 'active' and j.expires_at > now()
        and not exists (select 1 from applications a where a.job_id = j.id and a.candidate_id = $1)
      order by j.published_at desc limit 1`,
    [userId],
  ))[0];
  await page.goto(`${SITE}/jobs/${other.slug}/apply`);
  await page.fill('input[name="whatsapp"]', '01001234567');
  await context.setOffline(true);
  await submit(page).click();
  await sleep(2000);
  check('sent while offline, nothing is recorded', (await sql('select 1 from applications where candidate_id = $1 and job_id = $2', [userId, other.id])).length === 0);
  check('and the page does not claim it was sent', !/applied=1/.test(page.url()));
  await context.setOffline(false);
  await submit(page).click();
  check('back online, the same form sends it, and says so', await showsApplied(page), page.url());
  check('once', (await sql('select 1 from applications where candidate_id = $1 and job_id = $2', [userId, other.id])).length === 1);
  await context.close();
}

// ---------------------------------------------------------------------------
section('a visitor presses Save, signs in where they stand, and the listing is saved');
{
  // The website's sign-in sheet (src/components/auth/sign-in-gate.tsx): Save,
  // Follow and Apply open it over the page for somebody signed out, and the
  // action goes through once they are in — as the app's sheet does. The
  // candidate made above, on a fresh browser with no session.
  const { page, context, errors } = await device();
  const listing = (await sql("select slug, id from jobs where status = 'active' and expires_at > now() order by published_at desc limit 1"))[0];
  await page.goto(`${SITE}/jobs/${listing.slug}`);
  const save = page.locator('main button[aria-pressed="false"]').first();
  await save.click();
  const dialog = page.locator('[role="dialog"]');
  check('Save signed out opens the sign-in dialog, on the listing', (await dialog.count()) === 1 && path(page) === `/jobs/${listing.slug}`, page.url());
  await dialog.locator('input[name="email"]').fill(email);
  await dialog.locator('input[name="password"]').fill(password);
  await dialog.locator('form button[type="submit"]').click();
  let saved = false;
  for (let i = 0; i < 40 && !saved; i += 1) {
    await sleep(500);
    saved = (await sql('select 1 from saved_jobs where candidate_id = $1 and job_id = $2', [userId, listing.id])).length === 1;
  }
  check('signing in there saves the listing, with no second press', saved);
  check('the dialog has closed and the reader is still on the listing', (await dialog.count()) === 0 && path(page) === `/jobs/${listing.slug}`, page.url());
  check('the page now draws them signed in', (await page.locator('main button[aria-pressed="true"]').count()) >= 1);
  check('none of it threw a script error', errors.length === 0, errors.slice(0, 3));
  await context.close();
}

{
  // Apply, signed out: the same dialog, naming the listing; dismissed, nothing moves.
  const { page, context } = await device();
  const listing = (await sql("select slug, title_ar from jobs where status = 'active' and expires_at > now() order by published_at desc limit 1"))[0];
  await page.goto(`${SITE}/jobs/${listing.slug}`);
  // At this width the apply button is the summary's (jobs.apply); the phone bar's is hidden.
  await page.locator('main button:visible', { hasText: JOBS.apply }).first().click();
  const dialog = page.locator('[role="dialog"]');
  check('Apply signed out opens the sign-in dialog', (await dialog.count()) === 1, page.url());
  check('and names the listing', (await dialog.getByText(listing.title_ar, { exact: false }).count()) >= 1);
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Escape closes it and leaves the reader where they were', (await dialog.count()) === 0 && path(page) === `/jobs/${listing.slug}`, page.url());
  await context.close();
}

// ---------------------------------------------------------------------------
section('a session that ends underneath the page');
{
  const { page, context } = await device();
  await signInThroughForm(page, email, password);
  await landsOn(page, /\/dashboard/);
  // Signed out everywhere from another device: GoTrue's global scope.
  const token = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  const out = await fetch(`${SUPABASE}/auth/v1/logout?scope=global`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${token.access_token}` } });
  check('another device signs out everywhere', out.status === 204, `${out.status}`);
  await page.goto(`${SITE}/dashboard/account`);
  check('the next page asks this browser to sign in again', await landsOn(page, /\/sign-in/), page.url());

  // A cookie that has been tampered with or has expired: the same answer, not an error page.
  await signInThroughForm(page, email, password);
  await landsOn(page, /\/dashboard/);
  const cookies = await context.cookies();
  const auth = cookies.filter((cookie) => cookie.name.includes('auth-token'));
  check('the session lives in an auth cookie', auth.length > 0, cookies.map((c) => c.name));
  await context.clearCookies();
  await context.addCookies(auth.map((cookie) => ({ ...cookie, value: 'base64-eyJicm9rZW4iOnRydWV9' })));
  const broken = await page.goto(`${SITE}/dashboard`);
  check('a corrupted session cookie is treated as signed out', broken?.status() === 200 && /\/sign-in/.test(path(page)), `${broken?.status()} ${page.url()}`);
  await context.close();
}

// ---------------------------------------------------------------------------
section('signing out, and a wrong password');
{
  const { page, context } = await device();
  await signInThroughForm(page, email, `${password}-wrong`);
  await sleep(2000);
  check('a wrong password keeps them on the sign-in form', /\/sign-in/.test(path(page)), page.url());
  check('and says so', (await page.locator('[role="alert"]').count()) > 0);
  await signInThroughForm(page, email, password);
  check('the right one signs in', await landsOn(page, /\/dashboard/), page.url());
  // The account menu's sign-out button.
  // The dashboard's own sidebar carries the sign-out button.
  await page.locator('button:visible').filter({ hasText: 'تسجيل الخروج' }).first().click();
  check('signing out reloads the page signed out', await landsOn(page, /^\/(sign-in.*)?$/), page.url());
  const after = await page.goto(`${SITE}/dashboard`);
  check('after signing out, the dashboard asks for a sign-in', /\/sign-in/.test(path(page)), `${after?.status()} ${page.url()}`);
  await context.close();
}

// ---------------------------------------------------------------------------
section('a forgotten password, by email');
if (MAIL_DIR) {
  const { page, context } = await device();
  const before = new Set(readdirSync(MAIL_DIR));
  await page.goto(`${SITE}/sign-in/forgot`);
  await page.fill('input[name="email"]', email);
  await submit(page).click();
  let message = null;
  for (let i = 0; i < 40 && !message; i += 1) {
    await sleep(250);
    const fresh = readdirSync(MAIL_DIR).filter((name) => !before.has(name));
    for (const name of fresh) {
      const text = readFileSync(join(MAIL_DIR, name), 'utf8');
      if (text.includes(email)) message = text;
    }
  }
  check('a reset email arrives', Boolean(message));
  // Quoted-printable: soft line breaks and =3D.
  const body = (message ?? '').replace(/=\r?\n/g, '').replace(/=3D/gi, '=').replace(/&amp;/g, '&');
  const link = body.match(/https?:\/\/[^"\s]+\/auth\/confirm\?[^"\s]+/)?.[0];
  check('with a link to the website’s confirm page', Boolean(link), body.slice(0, 200));
  if (link) {
    await page.goto(link.replace(/^https?:\/\/[^/]+/, SITE));
    // The page asks for one press, so a mail scanner opening the link spends nothing.
    await submit(page).click();
    check('the link leads to choosing a new password', await landsOn(page, /\/sign-in\/new-password/), page.url());
    const fresh = `E2e-${randomUUID()}`;
    const inputs = page.locator('input[type="password"]');
    for (let i = 0; i < (await inputs.count()); i += 1) await inputs.nth(i).fill(fresh);
    await submit(page).click();
    await sleep(3000);
    const signedIn = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: fresh }),
    });
    check('the new password signs in', signedIn.status === 200, `${signedIn.status}`);
    const previous = password;
    if (signedIn.status === 200) password = fresh;
    const old = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: previous }),
    });
    check('and the old one no longer does', old.status === 400, `${old.status}`);
    await page.goto(link.replace(/^https?:\/\/[^/]+/, SITE));
    await submit(page).click().catch(() => {});
    await sleep(2000);
    check('the same link used twice does not open the form again', !/\/sign-in\/new-password/.test(path(page)), page.url());
  }
  await context.close();
} else {
  console.log('  SKIP  the reset email (no MAIL_DIR)');
}

// ---------------------------------------------------------------------------
section('an approved employer: the console, and the company profile saved');
{
  const { page, context, errors } = await device();
  await signInThroughForm(page, 'employer1@demo.test');
  check('the employer signs in to their console', await landsOn(page, /\/employer/), page.url());
  for (const where of ['/employer', '/employer/jobs', '/employer/jobs/new', '/employer/applicants', '/employer/company', '/employer/talent', '/employer/billing', '/notifications']) {
    const opened = await page.goto(`${SITE}${where}`, { waitUntil: 'load' });
    check(`${where} opens`, opened?.status() === 200 && path(page) === where, `${opened?.status()} ${page.url()}`);
  }
  const companyId = (await sql("select m.company_id from company_members m join auth.users u on u.id = m.user_id where u.email = 'employer1@demo.test' limit 1"))[0]?.company_id;
  const [before] = await sql('select about_ar, version from companies where id = $1', [companyId]);
  // Typed once the page is live: filled before hydration, React put the
  // field's own default back after what was typed (seen on CI's runner).
  await page.goto(`${SITE}/employer/company`, { waitUntil: 'networkidle' });
  const about = `نبذة محدّثة من المتصفح ${Date.now()}`;
  const field = page.locator('textarea[name="aboutAr"]');
  for (let attempt = 0; attempt < 3 && (await field.inputValue()) !== about; attempt += 1) {
    await field.fill(about);
    await sleep(300);
  }
  check('the field holds exactly what was typed', (await field.inputValue()) === about);
  // The page has other forms (logo, papers, team); this is the profile's own button.
  await page.locator('form:has(textarea[name="aboutAr"]) button[type="submit"]').click();
  await sleep(2500);
  const [after] = await sql('select about_ar, version from companies where id = $1', [companyId]);
  check('the company profile saves from its form', after?.about_ar === about, after);
  check('and its version moves on, so an older open form cannot overwrite it', Number(after?.version) > Number(before?.version), { before: before?.version, after: after?.version });
  check('the console threw no script errors', errors.length === 0, errors.slice(0, 3));
  await context.close();
}

// Off unless the website was started with ADMIN_MFA_REQUIRED=true. The
// enrolment button is that other run (BROWSER_JOURNEY=admin-mfa in CI).
if (process.env.ADMIN_MFA_REQUIRED === 'true') await adminWithMfaRequired();
else await adminConsoleOpens();

section('the account deletes itself from the account page');
{
  check('the account is there before', (await sql('select 1 from auth.users where id = $1', [userId])).length === 1);
  const { page, context, errors } = await device();
  await signInThroughForm(page, email, password);
  check('they sign in once more', await landsOn(page, /\/dashboard/), page.url());
  // Deletion is its own page off the account hub, the same screen the app uses.
  await page.goto(`${SITE}/dashboard/account/delete`);
  const remove = page.locator('button').filter({ hasText: 'احذف حسابي نهائيًا' });
  check('the delete button waits for the word to be typed', await remove.first().isDisabled());
  await page.locator('label').filter({ hasText: 'للتأكيد' }).locator('input').fill('حذف');
  check('and opens once it is', await remove.first().isEnabled());
  await remove.first().click();
  check('deleting goes back to the home page, signed out', await landsOn(page, /^\/$/, 20000), page.url());
  check('the auth user is gone', (await sql('select 1 from auth.users where id = $1', [userId])).length === 0);
  check('the profile and applications are gone',
    (await sql('select 1 from profiles where id = $1', [userId])).length === 0 &&
    (await sql('select 1 from applications where candidate_id = $1', [userId])).length === 0);
  const back = await page.goto(`${SITE}/dashboard`);
  check('the dashboard asks for a sign-in again', /\/sign-in/.test(path(page)), `${back?.status()} ${page.url()}`);
  check('no script errors', errors.length === 0, errors.slice(0, 3));
  await context.close();
}

await browser.close();
// Leave nothing behind that a re-run would trip over.
if (userId) await sql('delete from auth.users where id = $1', [userId]).catch(() => {});
await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
