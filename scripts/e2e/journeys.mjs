/**
 * The app's journeys, end to end, against the real thing: a Supabase stack
 * built from the migrations and the demo seed, and a production build of the
 * website serving /api/mobile/v1 — every request the phone would send, sent.
 *
 *   SITE_URL=http://localhost:3000 SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=… DEMO_PASSWORD=… node scripts/e2e/journeys.mjs
 *
 * .github/workflows/e2e.yml starts both and runs this. Never against
 * production: it signs in as the demo accounts, applies, moves applications,
 * posts a listing and deletes an account it creates.
 *
 * What the unit suites and the contract replay cannot see is checked here:
 * that a server action, run by the website's own code with a person's token,
 * does what the app is told it did — the row written under row-level
 * security, the trigger that fired, the notification that arrived, the
 * refusal where a refusal is owed.
 */
const SITE = required('SITE_URL').replace(/\/$/, '');
const SUPABASE = required('SUPABASE_URL').replace(/\/$/, '');
const ANON = required('SUPABASE_ANON_KEY');
const PASSWORD = required('DEMO_PASSWORD');

for (const url of [SITE, SUPABASE]) {
  if (url.includes('hiwdhicwsohbipxzazmb') || url.includes('brokersconnect.net')) {
    console.error(`Refusing to run journeys against production (${url}).`);
    process.exit(1);
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  return value;
}

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

/** Supabase Auth's password grant, as the app's sign-in screen calls it. */
async function signIn(email, password = PASSWORD) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, token: body.access_token ?? null, user: body.user ?? null, body };
}

/** A read under row-level security, as the app's Supabase client makes it. */
async function rest(token, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      authorization: `Bearer ${token ?? ANON}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

/** A server action through /api/mobile/v1, as callAction() sends it. */
async function action(token, name, input) {
  const response = await fetch(`${SITE}/api/mobile/v1/actions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(input ?? {}),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

/** A read the website builds (the board, the companies), as the app's api.ts asks for it. */
async function read(path, token) {
  const response = await fetch(`${SITE}/api/mobile/v1/${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** File bytes to Storage, as the app uploads a CV before it applies. */
async function upload(token, bucket, path, bytes, contentType) {
  const response = await fetch(`${SUPABASE}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': contentType, 'x-upsert': 'false' },
    body: bytes,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

const ok = (result) => result.status === 200 && result.json?.ok === true;
const describe = (result) => `${result.status} ${JSON.stringify(result.json)?.slice(0, 300)}`;

// ---------------------------------------------------------------------------
section('the public reads the app opens on');

const config = await read('config');
check('config answers', config.status === 200 && typeof config.json?.minAppVersion === 'string', describe(config));
const board = await read('jobs');
check('the board lists live jobs', board.status === 200 && board.json?.jobs?.length > 0, describe(board));
const browse = await read('browse');
check('the browse counts agree with the board', browse.status === 200 && browse.json?.total === board.json?.total, describe(browse));
const firstJob = board.json?.jobs?.[0];
const listing = firstJob ? await read(`jobs/${firstJob.slug}`) : { status: 0 };
check('a listing opens', listing.status === 200 && listing.json?.job?.id === firstJob?.id, describe(listing));
const companies = await read('companies');
check('the companies directory lists companies', companies.status === 200 && companies.json?.companies?.length > 0, describe(companies));
const firstCompany = companies.json?.companies?.[0];
const companyPage = firstCompany ? await read(`companies/${firstCompany.slug}`) : { status: 0 };
check('a company page opens', companyPage.status === 200 && companyPage.json?.company?.slug === firstCompany?.slug, describe(companyPage));
check('an unknown listing is a 404', (await read('jobs/no-such-listing-e2e')).status === 404);
const view = await action(null, 'recordJobView', { slug: firstJob?.slug });
check('a signed-out reader is counted as a view', view.status === 200, describe(view));

// ---------------------------------------------------------------------------
section('the candidate signs in');

const candidate = await signIn('candidate1@demo.test');
check('the password grant answers with a session', candidate.status === 200 && candidate.token, describe(candidate));
const wrong = await signIn('candidate1@demo.test', `${PASSWORD}-wrong`);
check('a wrong password is refused', wrong.status === 400 && !wrong.token, describe(wrong));
const me = await rest(candidate.token, `profiles?select=id,role,approval_status&id=eq.${candidate.user?.id}`);
check('the candidate reads their own profile', me.json?.[0]?.role === 'candidate', describe(me));
const summary = await rest(candidate.token, 'rpc/candidate_summary', { method: 'POST', body: {} });
check('the dashboard figures answer', summary.status === 200 && typeof summary.json?.applications_total === 'number', describe(summary));

// ---------------------------------------------------------------------------
section('saving, following and saved searches');

const savable = board.json.jobs[board.json.jobs.length - 1];
const savedBefore = await rest(candidate.token, `saved_jobs?select=job_id&job_id=eq.${savable.id}`);
const wasSaved = (savedBefore.json ?? []).length > 0;
const toggle = await action(candidate.token, 'toggleSavedJob', { jobId: savable.id });
check('the bookmark toggles', ok(toggle), describe(toggle));
const savedAfter = await rest(candidate.token, `saved_jobs?select=job_id&job_id=eq.${savable.id}`);
check('and the saved list says so', (savedAfter.json ?? []).length > 0 === !wasSaved, describe(savedAfter));
const toggleBack = await action(candidate.token, 'toggleSavedJob', { jobId: savable.id });
check('and toggles back', ok(toggleBack), describe(toggleBack));

const follow = await action(candidate.token, 'followCompany', { slug: firstCompany.slug, label: firstCompany.name_ar });
check('following a company', ok(follow), describe(follow));
const unfollow = await action(candidate.token, 'unfollowCompany', { slug: firstCompany.slug });
check('and unfollowing it', ok(unfollow), describe(unfollow));

const search = await action(candidate.token, 'saveSearch', { query: 'track=primary', label: 'بيع أول (e2e)' });
check('saving a search', ok(search), describe(search));
const searches = await rest(candidate.token, 'saved_searches?select=id,label,query');
const savedSearch = (searches.json ?? []).find((row) => row.label === 'بيع أول (e2e)');
check('the saved search is listed', Boolean(savedSearch), describe(searches));
if (savedSearch) {
  const removed = await action(candidate.token, 'deleteSavedSearch', { id: savedSearch.id });
  check('and can be deleted', ok(removed), describe(removed));
}

// ---------------------------------------------------------------------------
section('the candidate applies, with a CV');

// A live listing of a demo company the candidate has not applied to, and the
// employer account that runs it.
const mine = await rest(candidate.token, 'applications?select=job_id');
const applied = new Set((mine.json ?? []).map((row) => row.job_id));
let target = null;
let employer = null;
for (const key of ['employer1', 'employer2', 'employer3', 'employer4', 'employer5', 'employer6']) {
  const session = await signIn(`${key}@demo.test`);
  if (!session.token) continue;
  const companyId = (await rest(session.token, 'rpc/my_company_id', { method: 'POST', body: {} })).json;
  if (!companyId) continue;
  const company = (await rest(session.token, `companies?select=slug&id=eq.${companyId}`)).json?.[0];
  if (!company) continue;
  const theirs = await read(`jobs?company=${encodeURIComponent(company.slug)}`);
  const open = (theirs.json?.jobs ?? []).find((job) => !applied.has(job.id));
  if (open) {
    target = open;
    employer = { key, ...session };
    break;
  }
}
check('a listing to apply to', Boolean(target && employer), 'every demo listing already has this candidate');

let applicationId = null;
if (target && employer) {
  // The first bytes are what the server reads: a PDF is a PDF by them, not by its name.
  const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  const cvPath = `${candidate.user.id}/e2e-${Date.now()}.pdf`;
  const stored = await upload(candidate.token, 'cvs', cvPath, pdf, 'application/pdf');
  check('the CV uploads to the candidate’s own folder', stored.status === 200, describe(stored));
  const elsewhere = await upload(candidate.token, 'cvs', `${employer.user.id}/not-mine.pdf`, pdf, 'application/pdf');
  check('and not to somebody else’s', elsewhere.status >= 400, describe(elsewhere));

  const notAPdf = `${candidate.user.id}/e2e-${Date.now()}-fake.pdf`;
  await upload(candidate.token, 'cvs', notAPdf, new TextEncoder().encode('MZ this is not a pdf'), 'application/pdf');
  const refused = await action(candidate.token, 'applyToJob', {
    jobId: target.id,
    fullName: 'أحمد محمود',
    whatsapp: '+201112223344',
    experienceBand: 'junior_1_3',
    cvPath: notAPdf,
  });
  check('a file that is not a PDF is refused, whatever its name', refused.status === 200 && refused.json?.ok === false, describe(refused));

  const apply = await action(candidate.token, 'applyToJob', {
    jobId: target.id,
    fullName: 'أحمد محمود',
    whatsapp: '+201112223344',
    experienceBand: 'junior_1_3',
    cvPath,
    note: 'متاح أبدأ فوراً. (e2e)',
  });
  check('the application is sent', ok(apply), describe(apply));
  const again = await action(candidate.token, 'applyToJob', {
    jobId: target.id,
    fullName: 'أحمد محمود',
    whatsapp: '+201112223344',
    experienceBand: 'junior_1_3',
  });
  check('a second application to the same listing is refused', again.status === 200 && again.json?.ok === false, describe(again));

  const row = await rest(candidate.token, `applications?select=id,status,cv_path&job_id=eq.${target.id}`);
  applicationId = row.json?.[0]?.id ?? null;
  check('the candidate sees it, new, with its CV', row.json?.[0]?.status === 'new' && row.json?.[0]?.cv_path === cvPath, describe(row));
}

// ---------------------------------------------------------------------------
section('the employer works the application');

if (applicationId && employer) {
  const inbox = await rest(employer.token, `applications?select=id,status,employer_viewed_at&id=eq.${applicationId}`);
  check('the employer sees the applicant', inbox.json?.[0]?.id === applicationId, describe(inbox));

  const other = await signIn(employer.key === 'employer1' ? 'employer2@demo.test' : 'employer1@demo.test');
  const outsider = await rest(other.token, `applications?select=id&id=eq.${applicationId}`);
  check('another company does not', Array.isArray(outsider.json) && outsider.json.length === 0, describe(outsider));

  const seen = await action(employer.token, 'markApplicantsSeen', { ids: [applicationId] });
  check('opening it marks it seen', ok(seen), describe(seen));
  const viewed = await rest(candidate.token, `applications?select=employer_viewed_at&id=eq.${applicationId}`);
  check('and the candidate is told it was opened', Boolean(viewed.json?.[0]?.employer_viewed_at), describe(viewed));

  const note = await action(employer.token, 'addApplicationNote', { applicationId, body: 'مكالمة أولى يوم الأحد (e2e)' });
  check('a private note is added', ok(note), describe(note));
  const notes = await rest(employer.token, `application_notes?select=id,body&application_id=eq.${applicationId}`);
  check('the company reads it', (notes.json ?? []).some((row) => row.body.includes('e2e')), describe(notes));
  const candidateNotes = await rest(candidate.token, `application_notes?select=id&application_id=eq.${applicationId}`);
  check('the candidate never does', Array.isArray(candidateNotes.json) && candidateNotes.json.length === 0, describe(candidateNotes));

  const move = await action(employer.token, 'setApplicationStatus', { applicationId, status: 'shortlisted', from: 'new' });
  check('the applicant is shortlisted', ok(move), describe(move));
  const stale = await action(employer.token, 'setApplicationStatus', { applicationId, status: 'rejected', from: 'new' });
  check('a move from a status it no longer has is refused', stale.status === 200 && stale.json?.ok === false, describe(stale));
  const moved = await rest(candidate.token, `applications?select=status&id=eq.${applicationId}`);
  check('the candidate sees the new status', moved.json?.[0]?.status === 'shortlisted', describe(moved));

  const bell = await rest(candidate.token, 'notifications?select=id,kind,href,read_at&order=created_at.desc&limit=10');
  const status = (bell.json ?? []).find((row) => row.kind === 'application_moved');
  check('the move arrives in the candidate’s bell', Boolean(status), describe(bell));
  if (status) {
    const opened = await action(candidate.token, 'openNotification', { id: status.id });
    check('opening it says where to go', ok(opened) || typeof opened.json?.href === 'string', describe(opened));
    const read = await rest(candidate.token, `notifications?select=read_at&id=eq.${status.id}`);
    check('and marks it read', Boolean(read.json?.[0]?.read_at), describe(read));
  }

  const candidateMoves = await action(candidate.token, 'setApplicationStatus', { applicationId, status: 'hired', from: 'shortlisted' });
  check('a candidate cannot move their own application', candidateMoves.status === 200 && candidateMoves.json?.ok === false, describe(candidateMoves));

  const withdraw = await action(candidate.token, 'withdrawApplication', { applicationId });
  check('the candidate withdraws it', ok(withdraw), describe(withdraw));
  const gone = await rest(candidate.token, `applications?select=id&id=eq.${applicationId}`);
  check('and it is gone', Array.isArray(gone.json) && gone.json.length === 0, describe(gone));
}

// ---------------------------------------------------------------------------
section('the employer posts a listing');

if (employer) {
  const district = (await rest(employer.token, 'districts?select=id&limit=1')).json?.[0]?.id;
  const draft = {
    titleAr: 'استشاري مبيعات عقارية (e2e)',
    track: 'primary',
    employmentType: 'full_time',
    experienceBand: 'junior_1_3',
    seats: 2,
    districtId: district,
    basicSalaryMin: 9000,
    basicSalaryMax: 14000,
    commissionType: 'percentage',
    commissionValue: 1.5,
    leadsSource: 'company_provided',
    benefits: ['social_insurance'],
    descriptionAr: 'بيع وحدات سكنية في مشروعات كبار المطوّرين، مع تدريب وعملاء من حملات الشركة.',
    developerIds: [],
    idempotencyKey: crypto.randomUUID(),
    submit: true,
  };
  const posted = await action(employer.token, 'saveJob', draft);
  check('the listing is saved and sent for review', ok(posted) && typeof posted.json?.data?.id === 'string', describe(posted));
  const retried = await action(employer.token, 'saveJob', draft);
  check('the same request again lands on the same listing', ok(retried) && retried.json?.data?.id === posted.json?.data?.id, describe(retried));
  const row = await rest(employer.token, `jobs?select=id,status&id=eq.${posted.json?.data?.id}`);
  check('it waits for review, not live', row.json?.[0]?.status === 'pending_review', describe(row));
  const publicRead = await rest(null, `jobs?select=id&id=eq.${posted.json?.data?.id}`);
  check('and the public cannot see it', Array.isArray(publicRead.json) && publicRead.json.length === 0, describe(publicRead));
  const candidatePosts = await action(candidate.token, 'saveJob', { ...draft, idempotencyKey: crypto.randomUUID() });
  check('a candidate cannot post a listing', candidatePosts.status === 200 && candidatePosts.json?.ok === false, describe(candidatePosts));
}

// ---------------------------------------------------------------------------
section('somebody new: sign up, onboarding, and deleting the account');

const email = `e2e-${Date.now()}@example.com`;
const password = `E2e-${crypto.randomUUID()}`;
const signup = await fetch(`${SUPABASE}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const fresh = await signup.json().catch(() => ({}));
const freshToken = fresh.access_token ?? fresh.session?.access_token ?? null;
check('signing up answers with a session (confirmation is off locally)', signup.status === 200 && freshToken, `${signup.status}`);

if (freshToken) {
  const before = await rest(freshToken, 'profiles?select=id');
  check('there is no profile before onboarding', Array.isArray(before.json) && before.json.length === 0, describe(before));
  const unagreed = await action(freshToken, 'completeOnboarding', {
    role: 'candidate',
    fullName: 'حساب تجريبي',
    whatsapp: '+201001112233',
    locale: 'ar',
    visibility: 'hidden',
  });
  check('onboarding without agreeing to the terms is refused', unagreed.status === 200 && unagreed.json?.ok === false, describe(unagreed));
  const onboarded = await action(freshToken, 'completeOnboarding', {
    role: 'candidate',
    fullName: 'حساب تجريبي',
    whatsapp: '+201001112233',
    locale: 'ar',
    visibility: 'hidden',
    agreed: true,
  });
  check('onboarding creates the profile', ok(onboarded), describe(onboarded));
  const profile = await rest(freshToken, 'profiles?select=role');
  check('as a candidate', profile.json?.[0]?.role === 'candidate', describe(profile));

  const deleted = await action(freshToken, 'deleteMyAccount', {});
  check('the account deletes itself', ok(deleted), describe(deleted));
  const after = await signIn(email, password);
  check('and can no longer sign in', after.status === 400 && !after.token, describe(after));
}

// ---------------------------------------------------------------------------
section('doors');

const noToken = await action(null, 'applyToJob', { jobId: crypto.randomUUID() });
check('a protected action without a token is a 401', noToken.status === 401, describe(noToken));
const unknown = await action(candidate.token, 'moderateJob', {});
check('an admin action is not on the mobile API', unknown.status === 404, describe(unknown));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
