/**
 * The App Review accounts (supabase/review-accounts.sql), on the real
 * migrations. Run with: pnpm test:review-accounts  (also part of pnpm test:db)
 *
 * What App Review needs to find: an employer whose verified company has a
 * live listing with an applicant, a candidate who has applied to it and has a
 * second listing left to apply to, both through onboarding. What nobody else
 * should find: the reviewer in the directory.
 * And a second run changes nothing, and the removal leaves nothing behind.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb, reporter, runner, FIXTURES } from './setup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SQL = readFileSync(join(ROOT, 'supabase', 'review-accounts.sql'), 'utf8');
const versions = readFileSync(join(ROOT, 'src', 'lib', 'policy-versions.ts'), 'utf8');
const TERMS = versions.match(/terms: '(\d{4}-\d{2}-\d{2})'/)[1];
const PRIVACY = versions.match(/privacy: '(\d{4}-\d{2}-\d{2})'/)[1];

const report = reporter();
const db = await createTestDb();
const as = runner(db);
const one = async (sql) => (await db.query(sql)).rows[0];

const CANDIDATE = 'a1a1a1a1-0000-4000-8000-000000000001';
const EMPLOYER = 'a1a1a1a1-0000-4000-8000-000000000002';
const OTHER = 'a1a1a1a1-0000-4000-8000-000000000003';
await db.exec(`
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
    ('${CANDIDATE}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-candidate@example.com', now(), now(), now()),
    ('${EMPLOYER}',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-employer@example.com', now(), now(), now()),
    ('${OTHER}',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'someone@example.com', now(), now(), now());
`);

const PARAMS = {
  candidate: CANDIDATE,
  employer: EMPLOYER,
  candidatePhone: '+971507071591',
  employerPhone: '+971507071591',
  terms: TERMS,
  privacy: PRIVACY,
  cv: `${CANDIDATE}/review-cv.pdf`,
};

/** Runs the file with these parameters; an error comes back as its message. */
async function run(params) {
  try {
    await db.query(`select set_config('review.params', $1, false)`, [JSON.stringify(params)]);
    await db.exec(SQL);
    return null;
  } catch (error) {
    return error.message;
  }
}

const counts = async () =>
  one(`
    select
      (select count(*)::int from companies where slug = 'brokers-connect-app-review') as companies,
      (select count(*)::int from jobs where slug in ('app-review-property-consultant', 'app-review-sales-manager')) as jobs,
      (select count(*)::int from applications a join jobs j on j.id = a.job_id
         where j.slug in ('app-review-property-consultant', 'app-review-sales-manager')) as applications,
      (select count(*)::int from agent_profiles where user_id = '${CANDIDATE}') as agent_profiles,
      (select count(*)::int from policy_acceptances where user_id in ('${CANDIDATE}', '${EMPLOYER}')) as acceptances,
      (select count(*)::int from profiles where id in ('${CANDIDATE}', '${EMPLOYER}')) as profiles
  `);

// ---------------------------------------------------------------------------
report.section('the first run makes both accounts');

report.check('runs', (await run(PARAMS)) === null);
const made = await counts();
report.check(
  'a company, two listings, an application, a directory profile, two agreements, two profiles',
  made.companies === 1 && made.jobs === 2 && made.applications === 1 && made.agent_profiles === 1 &&
    made.acceptances === 2 && made.profiles === 2,
  JSON.stringify(made),
);

const employer = await one(`select role, approval_status from profiles where id = '${EMPLOYER}'`);
report.check('the employer is an approved employer', employer.role === 'employer' && employer.approval_status === 'approved', JSON.stringify(employer));
const candidate = await one(`select role from profiles where id = '${CANDIDATE}'`);
report.check('the candidate is a candidate', candidate.role === 'candidate');

const company = await one(`
  select c.id, c.verification_status, c.verified_at is not null as verified_at,
         exists (select 1 from company_members m where m.company_id = c.id and m.user_id = '${EMPLOYER}') as member
    from companies c where c.slug = 'brokers-connect-app-review'`);
report.check('the company is verified, and the employer is its member', company.verification_status === 'verified' && company.verified_at && company.member, JSON.stringify(company));

const listings = (await db.query(`
  select slug, status, published_at is not null as published, expires_at > now() as open
    from jobs where slug in ('app-review-property-consultant', 'app-review-sales-manager') order by slug`)).rows;
report.check(
  'both listings are live, published and open',
  listings.length === 2 && listings.every((job) => job.status === 'active' && job.published && job.open),
  JSON.stringify(listings),
);

const agreed = await one(`
  select count(*)::int as n from policy_acceptances
   where user_id in ('${CANDIDATE}', '${EMPLOYER}') and terms_version = '${TERMS}' and privacy_version = '${PRIVACY}'`);
report.check('both agreed to the current Terms and Privacy policy', agreed.n === 2);

const flagged = await one(`select count(*)::int as n from reports where target_id = '${company.id}'`);
report.check('the company name raises no impersonation report', flagged.n === 0, `${flagged.n} reports`);

// ---------------------------------------------------------------------------
report.section('what each side sees');

const board = await as(null, `select slug from jobs where slug = 'app-review-property-consultant'`, 'anon');
report.check('the listing is on the public board', board.ok && board.rows.length === 1, board.error);

const pipeline = await as(EMPLOYER, `
  select a.status, a.cv_path, p.full_name, p.whatsapp_phone
    from applications a join jobs j on j.id = a.job_id join profiles p on p.id = a.candidate_id
   where j.slug = 'app-review-property-consultant'`);
report.check(
  'the employer sees the applicant: name, number, CV',
  pipeline.ok && pipeline.rows.length === 1 && pipeline.rows[0].full_name === 'مراجع التطبيق' &&
    pipeline.rows[0].whatsapp_phone === '+971507071591' && pipeline.rows[0].cv_path === PARAMS.cv &&
    pipeline.rows[0].status === 'new',
  pipeline.error ?? JSON.stringify(pipeline.rows),
);

const bell = await one(`select count(*)::int as n from notifications where user_id = '${EMPLOYER}'`);
report.check("the employer's bell has the application", bell.n >= 1, `${bell.n} notifications`);

const mine = await as(CANDIDATE, `select a.status from applications a join jobs j on j.id = a.job_id where j.slug = 'app-review-property-consultant'`);
report.check('the candidate sees the application', mine.ok && mine.rows.length === 1 && mine.rows[0].status === 'new', mine.error);

// The reviewer's own application, from the candidate account, as the app sends it.
const applying = await as(CANDIDATE, `
  insert into applications (job_id, candidate_id, status, experience_band, note)
  select id, '${CANDIDATE}', 'new', 'junior_1_3', 'review' from jobs where slug = 'app-review-sales-manager'
  returning id`);
report.check('the candidate can apply to the second listing', applying.ok && applying.rows.length === 1, applying.error);

const own = await as(CANDIDATE, `select visibility, cv_path from agent_profiles where user_id = '${CANDIDATE}'`);
report.check(
  'the candidate has a directory profile, hidden, with the CV',
  own.ok && own.rows.length === 1 && own.rows[0].visibility === 'hidden' && own.rows[0].cv_path === PARAMS.cv,
  own.error ?? JSON.stringify(own.rows),
);

const directory = await as(FIXTURES.employerVerified, `select count(*)::int as n from agent_profiles where user_id = '${CANDIDATE}'`);
report.check('another company browsing the directory does not see the reviewer', directory.ok && directory.rows[0].n === 0, directory.error);

// ---------------------------------------------------------------------------
report.section('running it again');

report.check('runs again', (await run(PARAMS)) === null);
const again = await counts();
report.check('changes nothing', JSON.stringify(again) === JSON.stringify(made), JSON.stringify(again));

const sameUser = await run({ ...PARAMS, employer: CANDIDATE });
report.check('refuses one user for both accounts', /two different users/.test(sameUser ?? ''), sameUser);

const taken = await run({ ...PARAMS, employer: OTHER });
report.check("refuses a company that is another account's", /belongs to another account/.test(taken ?? ''), taken);
const untouched = await one(`select count(*)::int as n from profiles where id = '${OTHER}'`);
report.check('and leaves nothing of that run', untouched.n === 0, `${untouched.n} profiles`);

// ---------------------------------------------------------------------------
report.section('the removal');

// Someone real applied to the review listing meanwhile: it goes with it.
await db.exec(`
  insert into applications (job_id, candidate_id, status, experience_band)
  select id, '${FIXTURES.publicAgent}', 'new', 'mid_3_5' from jobs where slug = 'app-review-property-consultant'`);

const removal = await run({ ...PARAMS, remove: true });
report.check('runs', removal === null, removal);
const removed = await counts();
report.check(
  'no company, listing, application or directory profile is left',
  removed.companies === 0 && removed.jobs === 0 && removed.applications === 0 && removed.agent_profiles === 0,
  JSON.stringify(removed),
);
const others = await one(`select count(*)::int as n from applications where candidate_id = '${FIXTURES.publicAgent}'`);
report.check("other listings' applications stay", others.n > 0, `${others.n}`);

// The script then deletes the two users through the Auth admin API.
await db.exec(`delete from auth.users where id in ('${CANDIDATE}', '${EMPLOYER}')`);
const gone = await counts();
report.check('deleting the users takes their profiles and agreements', gone.profiles === 0 && gone.acceptances === 0, JSON.stringify(gone));

report.check('and it can be made again afterwards', await (async () => {
  await db.exec(`
    insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
      ('${CANDIDATE}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-candidate@example.com', now(), now(), now()),
      ('${EMPLOYER}',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-employer@example.com', now(), now(), now())`);
  const error = await run(PARAMS);
  const remade = await counts();
  return error === null && remade.companies === 1 && remade.applications === 1;
})());

await db.close();
process.exit(report.finish() ? 0 : 1);
