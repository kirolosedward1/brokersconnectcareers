/**
 * The two accounts App Review signs in with (docs/app-store.md, "Review
 * accounts"): a candidate who has applied, and an employer whose verified
 * company has two live listings, the first with that applicant and the second
 * left for the reviewer to apply to.
 *
 *   pnpm review-accounts                                   what it would do; reads only
 *   pnpm review-accounts --execute --confirm <ref>         makes them, or refreshes them
 *   pnpm review-accounts --remove --execute --confirm <ref>   takes them away after App Review
 *
 * <ref> is the project's id, the first part of NEXT_PUBLIC_SUPABASE_URL's host
 * (production: hiwdhicwsohbipxzazmb). Needs, as for `pnpm db:apply`:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and TARGET_DATABASE_URL
 *   (the same project's database);
 * and the two addresses, inboxes someone reads — the employer's gets the "new
 * applicant" email:
 *   REVIEW_CANDIDATE_EMAIL, REVIEW_EMPLOYER_EMAIL;
 * and, if not the operator's (src/lib/business.ts), the number both profiles
 * show, which the applicant card's WhatsApp button dials:
 *   REVIEW_PHONE.
 *
 * Users go through the Auth admin API, as in scripts/seed-demo.mjs (GoTrue's
 * own rows); the CV through Storage; everything else is
 * supabase/review-accounts.sql in one transaction, which
 * supabase/tests/review-accounts.test.mjs runs on the real migrations. Run
 * again, it keeps the two users, gives them new passwords and starts the
 * review over (what the last review left goes; see the SQL). The passwords
 * are printed once, as the APP_REVIEW_* lines store.config.js reads.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, require_, ROOT } from './env.mjs';

export const CV_BUCKET = 'cvs';
export const CV_NAME = 'review-cv.pdf';

const NAMES = { candidate: 'مراجع التطبيق', employer: 'فريق مراجعة التطبيق' };

/** The project id in a Supabase URL; for anything else (a local stack), its host. */
export function projectRef(supabaseUrl) {
  const host = new URL(supabaseUrl).host;
  return host.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] ?? host;
}

export function parseArgs(argv) {
  const args = { execute: false, remove: false, confirm: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--execute') args.execute = true;
    else if (argv[i] === '--remove') args.remove = true;
    else if (argv[i] === '--confirm') {
      args.confirm = argv[i + 1] ?? null;
      i += 1;
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

/** Random, with one of each kind of character a password policy can ask for. */
export function newPassword() {
  return `${randomBytes(15).toString('base64url')}Aa7!`;
}

/** A one-page PDF the employer opens as the applicant's CV. */
export function samplePdf() {
  const stream = 'BT /F1 16 Tf 72 760 Td (Sample CV - App Review account, Brokers Connect) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const at = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** A value from one of the website's pure modules, read as text: they are TypeScript. */
function fromSource(file, pattern) {
  const found = readFileSync(join(ROOT, file), 'utf8').match(pattern);
  if (!found) throw new Error(`${file} no longer says ${pattern}`);
  return found[1];
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = require_('NEXT_PUBLIC_SUPABASE_URL', 'Project Settings → API → Project URL');
  const serviceKey = require_('SUPABASE_SERVICE_ROLE_KEY', 'Project Settings → API → service_role');
  const databaseUrl = require_('TARGET_DATABASE_URL', 'the session pooler URI, as for pnpm db:apply');
  const emails = {
    candidate: require_('REVIEW_CANDIDATE_EMAIL', 'an inbox you read, for the candidate App Review signs in as').toLowerCase(),
    employer: require_('REVIEW_EMPLOYER_EMAIL', 'an inbox you read, for the employer App Review signs in as').toLowerCase(),
  };
  if (emails.candidate === emails.employer) {
    console.error('REVIEW_CANDIDATE_EMAIL and REVIEW_EMPLOYER_EMAIL must be two addresses.');
    process.exit(1);
  }
  const phone = process.env.REVIEW_PHONE?.trim() || fromSource('src/lib/business.ts', /phone: '(\+\d+)'/);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    console.error(`REVIEW_PHONE must be a number in international form, like +201001234567 (got ${phone}).`);
    process.exit(1);
  }

  const ref = projectRef(supabaseUrl);
  if (/^[a-z0-9]{20}$/.test(ref) && !databaseUrl.includes(ref)) {
    console.error(`TARGET_DATABASE_URL is not ${ref}'s database: the users and their rows would land in two projects.`);
    process.exit(1);
  }
  if (args.execute && args.confirm !== ref) {
    console.error(`This writes to ${ref}. To go ahead, add --confirm ${ref}.`);
    process.exit(1);
  }

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const call = async (path, { method = 'GET', body, type = 'application/json' } = {}) => {
    const response = await fetch(new URL(path, supabaseUrl), {
      method,
      headers: { ...headers, ...(body ? { 'Content-Type': type } : {}), ...(path.startsWith('/storage/') ? { 'x-upsert': 'true' } : {}) },
      body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };

  // Every page of users, until the address turns up (the admin API pages by 1,000 at most).
  const findUser = async (email) => {
    for (let page = 1; ; page += 1) {
      const { users = [] } = await call(`/auth/v1/admin/users?page=${page}&per_page=1000`);
      const user = users.find((candidate) => candidate.email?.toLowerCase() === email);
      if (user) return user;
      if (users.length < 1000) return null;
    }
  };

  const pg = (await import('pg')).default;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const sql = readFileSync(join(ROOT, 'supabase', 'review-accounts.sql'), 'utf8');
  const runSql = async (params) => {
    await db.query('begin');
    try {
      await db.query(`select set_config('review.params', $1, true)`, [JSON.stringify(params)]);
      await db.query(sql);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  };

  try {
    const existing = { candidate: await findUser(emails.candidate), employer: await findUser(emails.employer) };
    const company = (await db.query(`select exists (select 1 from companies where slug = 'brokers-connect-app-review') as made`)).rows[0];

    console.log(`Project ${ref}${args.remove ? ', removing the review accounts' : ''}`);
    for (const key of ['candidate', 'employer']) {
      console.log(`  ${key.padEnd(9)} ${emails[key]}: ${existing[key] ? `exists (${existing[key].id})` : 'not yet made'}`);
    }
    console.log(`  company   brokers-connect-app-review: ${company.made ? 'exists' : 'not yet made'}`);
    if (!args.execute) {
      console.log(`\nNothing was changed. To go ahead: --execute --confirm ${ref}`);
      return;
    }

    if (args.remove) {
      await runSql({
        candidate: existing.candidate?.id ?? randomUUID(),
        employer: existing.employer?.id ?? randomUUID(),
        remove: true,
      });
      if (existing.candidate) {
        await call(`/storage/v1/object/${CV_BUCKET}`, {
          method: 'DELETE',
          body: { prefixes: [`${existing.candidate.id}/${CV_NAME}`] },
        });
      }
      for (const key of ['candidate', 'employer']) {
        if (existing[key]) await call(`/auth/v1/admin/users/${existing[key].id}`, { method: 'DELETE' });
      }
      console.log('\nRemoved: the listings, their applications, the company, the directory profile, the CV and both users.');
      return;
    }

    const passwords = { candidate: newPassword(), employer: newPassword() };
    const ids = {};
    for (const key of ['candidate', 'employer']) {
      const user = existing[key]
        ? await call(`/auth/v1/admin/users/${existing[key].id}`, {
            method: 'PUT',
            body: { password: passwords[key], email_confirm: true },
          })
        : await call('/auth/v1/admin/users', {
            method: 'POST',
            body: { email: emails[key], password: passwords[key], email_confirm: true, user_metadata: { full_name: NAMES[key] } },
          });
      ids[key] = user.id;
    }

    const cv = `${ids.candidate}/${CV_NAME}`;
    await call(`/storage/v1/object/${CV_BUCKET}/${cv}`, { method: 'POST', body: samplePdf(), type: 'application/pdf' });

    await runSql({
      candidate: ids.candidate,
      employer: ids.employer,
      candidatePhone: phone,
      employerPhone: phone,
      terms: fromSource('src/lib/policy-versions.ts', /terms: '(\d{4}-\d{2}-\d{2})'/),
      privacy: fromSource('src/lib/policy-versions.ts', /privacy: '(\d{4}-\d{2}-\d{2})'/),
      cv,
    });

    console.log('\nReady. For `npx eas-cli@latest metadata:push` in mobile/ (docs/app-store.md, "The listing, as code"):\n');
    console.log(`export APP_REVIEW_CANDIDATE_EMAIL='${emails.candidate}'`);
    console.log(`export APP_REVIEW_CANDIDATE_PASSWORD='${passwords.candidate}'`);
    console.log(`export APP_REVIEW_EMPLOYER_EMAIL='${emails.employer}'`);
    console.log(`export APP_REVIEW_EMPLOYER_PASSWORD='${passwords.employer}'`);
    console.log('\nThe passwords are not kept anywhere else: running this again sets new ones.');
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
