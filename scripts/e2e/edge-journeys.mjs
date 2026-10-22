/**
 * The journeys again, at their edges: a person who is brand new and has
 * nothing yet, one who comes back, one who types the wrong thing, presses the
 * button twice, loses the connection half way, is on a slow line, holds a
 * token that has expired or was signed out elsewhere — and then tries again.
 *
 *   SITE_URL=http://localhost:3000 SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_ANON_KEY=… DATABASE_URL=postgres://… DEMO_PASSWORD=… \
 *   [SUPABASE_JWT_SECRET=…] node scripts/e2e/edge-journeys.mjs
 *
 * journeys.mjs proves each path works once. This proves what the database
 * holds afterwards, read directly over DATABASE_URL rather than through the
 * API that answered: one application after two clicks, one listing after a
 * retried post, no profile after a refused form, nothing left of an account
 * that deleted itself. An answer of `ok` the rows do not back is a failure
 * here.
 *
 * Every account it makes is new (e2e-edge-<time>@example.com) and is deleted
 * again at the end where the product allows it, so it can run after
 * journeys.mjs, or twice. Never against production: it refuses to.
 */
import pg from 'pg';
import { createHmac, randomUUID } from 'node:crypto';

const SITE = required('SITE_URL').replace(/\/$/, '');
const SUPABASE = required('SUPABASE_URL').replace(/\/$/, '');
const ANON = required('SUPABASE_ANON_KEY');
const PASSWORD = required('DEMO_PASSWORD');
const DATABASE_URL = required('DATABASE_URL');
// Optional: with it, an expired token can be made rather than waited for.
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || '';

for (const url of [SITE, SUPABASE, DATABASE_URL]) {
  if (url.includes('hiwdhicwsohbipxzazmb') || url.includes('brokersconnect.net')) {
    console.error(`Refusing to run journeys against production (${url.replace(/\/\/[^@]*@/, '//…@')}).`);
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

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
/** The database's own answer, read past row-level security. */
async function sql(text, params = []) {
  return (await db.query(text, params)).rows;
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

async function signIn(email, password = PASSWORD) {
  const response = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    token: body.access_token ?? null,
    refresh: body.refresh_token ?? null,
    user: body.user ?? null,
    body,
  };
}

async function signUp(email, password) {
  const response = await fetch(`${SUPABASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    token: body.access_token ?? body.session?.access_token ?? null,
    refresh: body.refresh_token ?? body.session?.refresh_token ?? null,
    user: body.user ?? null,
  };
}

async function rest(token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      authorization: `Bearer ${token ?? ANON}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
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

async function action(token, name, input, { signal, body } = {}) {
  const response = await fetch(`${SITE}/api/mobile/v1/actions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ?? JSON.stringify({ input: input ?? null }),
    signal,
    ...(body && typeof body !== 'string' ? { duplex: 'half' } : {}),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function read(path, token) {
  const response = await fetch(`${SITE}/api/mobile/v1/${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function upload(token, bucket, path, bytes, contentType) {
  const response = await fetch(`${SUPABASE}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': contentType, 'x-upsert': 'false' },
    body: bytes,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** What `after()` writes once the answer has gone, looked for until it shows. */
async function eventually(probe, test, timeout = 8000) {
  const until = Date.now() + timeout;
  let last = await probe();
  while (!test(last) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await probe();
  }
  return last;
}

const ok = (result) => result.status === 200 && result.json?.ok === true;
const refused = (result, error) =>
  result.status === 200 && result.json?.ok === false && (error === undefined || result.json?.error === error);
const describe = (result) => `${result.status} ${JSON.stringify(result.json)?.slice(0, 300)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An access token signed with the project's secret, for claims no real session has (an expiry in the past). */
function mintToken(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode(claims);
  const signature = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
// A 1×1 PNG: the smallest picture the server will decode and write again.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const stamp = Date.now();
const made = []; // { email, password, token } of every account this run created

// ---------------------------------------------------------------------------
section('a fresh candidate: nothing yet, and the forms that refuse');

const candidateEmail = `e2e-edge-${stamp}-c@example.com`;
const candidatePassword = `E2e-${randomUUID()}`;
const fresh = await signUp(candidateEmail, candidatePassword);
check('signing up answers with a session', fresh.status === 200 && fresh.token, `${fresh.status}`);
const freshId = fresh.user?.id;
made.push({ email: candidateEmail, password: candidatePassword, id: freshId });

let token = fresh.token;
check('the account exists in auth and has no profile', (await sql('select 1 from auth.users where id = $1', [freshId])).length === 1 &&
  (await sql('select 1 from profiles where id = $1', [freshId])).length === 0);

// Before onboarding, the things only an onboarded person does are refused, and leave nothing.
const board = await read('jobs');
const someJob = board.json?.jobs?.[0];
const early = await action(token, 'applyToJob', {
  jobId: someJob?.id,
  fullName: 'قبل التسجيل',
  whatsapp: '+201001234567',
  experienceBand: 'fresh_0_1',
});
check('applying before onboarding is refused', refused(early), describe(early));
check('and writes no application', (await sql('select 1 from applications where candidate_id = $1', [freshId])).length === 0);

const base = { role: 'candidate', fullName: 'مرشح تجريبي', whatsapp: '+201001112233', locale: 'ar', visibility: 'hidden', agreed: true };
const badInputs = [
  ['a one-letter name', { ...base, fullName: 'م' }, 'fullName'],
  ['a phone a digit short', { ...base, whatsapp: '0100 123 456' }, 'whatsapp'],
  ['a phone that is letters', { ...base, whatsapp: 'not-a-phone' }, 'whatsapp'],
  ['no visibility answer', { ...base, visibility: undefined }, 'visibility'],
  ['the terms not agreed', { ...base, agreed: false }, 'agreed'],
  ['an employer with no company', { ...base, role: 'employer' }, 'company'],
  ['an admin, asked for', { ...base, role: 'admin' }, 'role'],
];
for (const [label, input, field] of badInputs) {
  const result = await action(token, 'completeOnboarding', input);
  check(`onboarding refuses ${label}, naming the field`, refused(result, 'invalid') && field in (result.json?.fieldErrors ?? {}), describe(result));
}
const scripted = await action(token, 'completeOnboarding', { ...base, fullName: '<script>alert(1)</script>أحمد' });
check('a name with markup in it is accepted', ok(scripted), describe(scripted));
const [stored] = await sql('select full_name, role, whatsapp_phone, approval_status from profiles where id = $1', [freshId]);
check('and stored without the markup', stored && !/[<>]/.test(stored.full_name), stored);
check('the profile is a candidate with the number normalised', stored?.role === 'candidate' && stored?.whatsapp_phone === '+201001112233', stored);
const [card] = await sql('select id, visibility, visibility_chosen_at from agent_profiles where user_id = $1', [freshId]);
check('a directory card exists, hidden as answered, and the answer is dated', card?.visibility === 'hidden' && card?.visibility_chosen_at, card);
const accepted = await sql('select terms_version, privacy_version from policy_acceptances where user_id = $1', [freshId]);
check('what they agreed to is recorded', accepted.length >= 1, accepted);

// The same form sent twice at once, and once more from a tab that thought it was an employer.
const twice = await Promise.all([action(token, 'completeOnboarding', base), action(token, 'completeOnboarding', base)]);
check('onboarding sent twice at once answers ok both times', twice.every(ok), twice.map(describe));
const asEmployer = await action(token, 'completeOnboarding', { ...base, role: 'employer', company: { nameAr: 'شركة من تبويب قديم' } });
check('a stale employer tab is told the role the account really has', ok(asEmployer) && asEmployer.json?.data?.role === 'candidate', describe(asEmployer));
check('one profile, still a candidate', (await sql("select role from profiles where id = $1", [freshId])).map((r) => r.role).join() === 'candidate');
check('one directory card', (await sql('select 1 from agent_profiles where user_id = $1', [freshId])).length === 1);
check('and no company was made for them', (await sql('select 1 from companies where owner_id = $1', [freshId])).length === 0);

// Empty states: everything a new candidate's screens read, empty and not an error.
const summary = await rest(token, 'rpc/candidate_summary', { method: 'POST', body: {} });
check('the dashboard figures are zero, not an error', summary.status === 200 && summary.json?.applications_total === 0, describe(summary));
for (const table of ['applications', 'saved_jobs', 'saved_searches', 'notifications']) {
  const rows = await rest(token, `${table}?select=*`);
  check(`an empty ${table} list reads as []`, rows.status === 200 && Array.isArray(rows.json) && rows.json.length === 0 || table === 'notifications' && rows.status === 200, describe(rows));
}

// ---------------------------------------------------------------------------
section('profile management, checked in the rows');

const agentProfile = {
  fullName: 'مرشح تجريبي',
  whatsapp: '+201001112233',
  headlineAr: 'استشاري مبيعات',
  yearsExperience: 4,
  tracks: ['primary', 'resale'],
  districtIds: [],
  developerIds: [],
  languages: ['ar', 'en'],
  availability: 'open_to_offers',
  visibility: 'verified_employers_only',
};
const badPhone = await action(token, 'saveAgentProfile', { ...agentProfile, whatsapp: '0100' });
check('a profile with a bad phone is refused', refused(badPhone), describe(badPhone));
const badYears = await action(token, 'saveAgentProfile', { ...agentProfile, yearsExperience: 99 });
check('a profile with 99 years is refused', refused(badYears, 'invalid'), describe(badYears));
const [unchanged] = await sql('select years_experience, visibility from agent_profiles where user_id = $1', [freshId]);
check('and the refused saves changed nothing', unchanged?.visibility === 'hidden', unchanged);
const savedProfile = await action(token, 'saveAgentProfile', agentProfile);
check('the profile saves', ok(savedProfile), describe(savedProfile));
const [after] = await sql('select a.years_experience, a.visibility, a.tracks, a.headline_ar from agent_profiles a where a.user_id = $1', [freshId]);
check('and the row holds what was sent', after?.years_experience === 4 && after?.visibility === 'verified_employers_only' && after?.headline_ar === 'استشاري مبيعات', after);

const agentId = card?.id;
const backwards = await action(token, 'saveExperience', { agentId, companyName: 'شركة', title: 'استشاري', started: '2024-05-01', ended: '2023-01-01' });
check('an experience that ends before it starts is refused', refused(backwards, 'invalid'), describe(backwards));
const experience = await action(token, 'saveExperience', { agentId, companyName: 'بالم هيلز', title: 'استشاري مبيعات', track: 'primary', started: '2022-01-01', ended: null });
check('an experience is added', ok(experience) && experience.json?.data?.id, describe(experience));
const experienceId = experience.json?.data?.id;
const edited = await action(token, 'saveExperience', { id: experienceId, agentId, companyName: 'بالم هيلز', title: 'مدير مبيعات', started: '2022-01-01' });
check('and edited in place', ok(edited) && edited.json?.data?.id === experienceId, describe(edited));
check('one row, holding the edit', (await sql('select title from agent_experience where agent_id = $1', [agentId])).map((r) => r.title).join() === 'مدير مبيعات');
const education = await action(token, 'saveEducation', { agentId, institution: 'جامعة القاهرة', degree: 'بكالوريوس', graduated: 2018 });
check('an education entry is added', ok(education), describe(education));
const certification = await action(token, 'saveCertification', { agentId, name: 'شهادة مبيعات', issued: '2023-01-01', expires: '2022-01-01' });
check('a certification that expires before it is issued is refused', refused(certification, 'invalid'), describe(certification));
const record = await action(token, 'saveProfileRecord', { summaryAr: 'أبيع شقق في التجمع', unitsClosed: 12, volumeEgp: 30000000 });
check('the sales record saves', ok(record), describe(record));
check('and is on the card', (await sql('select units_closed from agent_profiles where user_id = $1', [freshId]))[0]?.units_closed === 12);

const prefs = await action(token, 'updateNotificationPreferences', { notify_applications: false, notify_status: true, notify_digest: false, notify_applicant_digest: false });
check('email preferences save', ok(prefs), describe(prefs));
const [prefRow] = await sql('select notify_applications, notify_status, notify_digest from profiles where id = $1', [freshId]);
check('and the switches are what was sent', prefRow?.notify_applications === false && prefRow?.notify_status === true && prefRow?.notify_digest === false, prefRow);
const pushNothing = await action(token, 'updatePushPreferences', {});
check('a push preference change with nothing in it is refused', refused(pushNothing, 'invalid'), describe(pushNothing));
const pushOne = await action(token, 'updatePushPreferences', { push_job_alerts: false });
check('one push switch saves alone', ok(pushOne), describe(pushOne));
const [pushRow] = await sql('select push_job_alerts, push_applications from profiles where id = $1', [freshId]);
check('and leaves the others as they were', pushRow?.push_job_alerts === false && pushRow?.push_applications === true, pushRow);

const avatarForm = new FormData();
avatarForm.set('input', JSON.stringify({ kind: 'avatar' }));
avatarForm.set('kind', 'avatar');
avatarForm.set('file', new Blob([PNG], { type: 'image/png' }), 'me.png');
const avatarResponse = await fetch(`${SITE}/api/mobile/v1/actions/uploadImage`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: avatarForm,
});
const avatar = { status: avatarResponse.status, json: await avatarResponse.json().catch(() => null) };
check('a profile photo uploads', ok(avatar) && typeof avatar.json?.data?.url === 'string', describe(avatar));
const fakeForm = new FormData();
fakeForm.set('kind', 'avatar');
fakeForm.set('file', new Blob([new TextEncoder().encode('MZ not a picture')], { type: 'image/png' }), 'me.png');
const fakeResponse = await fetch(`${SITE}/api/mobile/v1/actions/uploadImage`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: fakeForm,
});
const fake = { status: fakeResponse.status, json: await fakeResponse.json().catch(() => null) };
check('a file that is not a picture is refused as a photo', refused(fake), describe(fake));

// ---------------------------------------------------------------------------
section('applying: wrong input, two clicks, a dropped connection, a slow line');

const jobs = (board.json?.jobs ?? []).filter((job) => job.id);
const [jobA, jobB, jobC, jobD] = jobs;
const application = (jobId, extra = {}) => ({
  jobId,
  fullName: 'مرشح تجريبي',
  whatsapp: '+201001112233',
  experienceBand: 'junior_1_3',
  ...extra,
});

const badApply = await action(token, 'applyToJob', application(jobA.id, { whatsapp: '123', fullName: 'اسم جديد' }));
check('an application with a short phone names the phone', refused(badApply, 'invalid') && badApply.json?.fieldErrors?.whatsapp === 'invalidPhone', describe(badApply));
const noJob = await action(token, 'applyToJob', application(randomUUID()));
check('an application to a listing that does not exist is refused', refused(noJob), describe(noJob));
check('neither wrote an application, nor renamed the profile',
  (await sql('select 1 from applications where candidate_id = $1', [freshId])).length === 0 &&
  (await sql('select full_name from profiles where id = $1', [freshId]))[0]?.full_name !== 'اسم جديد');
const theirs = await action(token, 'applyToJob', application(jobA.id, { cvPath: `${randomUUID()}/cv.pdf` }));
check('a CV path in somebody else’s folder is refused', refused(theirs, 'invalid_cv_path'), describe(theirs));
const climbing = await action(token, 'applyToJob', application(jobA.id, { cvPath: `${freshId}/../${randomUUID()}/cv.pdf` }));
check('and so is one that climbs out of their own', refused(climbing, 'invalid_cv_path'), describe(climbing));

const disguised = `${freshId}/edge-${stamp}-disguised.pdf`;
const disguisedUpload = await upload(token, 'cvs', disguised, new TextEncoder().encode('MZ\x90\x00 an executable, named .pdf'), 'application/pdf');
check('a disguised file can reach the bucket', disguisedUpload.status === 200, describe(disguisedUpload));
const disguisedApply = await action(token, 'applyToJob', application(jobA.id, { cvPath: disguised }));
check('but an application carrying it is refused as the wrong type', refused(disguisedApply, 'invalid') && disguisedApply.json?.fieldErrors?.cv === 'fileType', describe(disguisedApply));
check('and the file is taken out of the bucket', (await sql("select 1 from storage.objects where bucket_id = 'cvs' and name = $1", [disguised])).length === 0);

// Recovery: the same person, the mistake corrected, goes straight through.
const cvPath = `${freshId}/edge-${stamp}.pdf`;
check('a real PDF uploads', (await upload(token, 'cvs', cvPath, PDF, 'application/pdf')).status === 200);
// Two clicks: the same application sent twice at the same moment.
const doubled = await Promise.all([
  action(token, 'applyToJob', application(jobA.id, { cvPath })),
  action(token, 'applyToJob', application(jobA.id, { cvPath })),
]);
check('two clicks: one is sent', doubled.filter(ok).length === 1, doubled.map(describe));
check('and the other is told it already was', doubled.filter((r) => refused(r, 'already_applied')).length === 1, doubled.map(describe));
check('exactly one application row, with the CV', (await sql('select cv_path from applications where candidate_id = $1 and job_id = $2', [freshId, jobA.id])).map((r) => r.cv_path).join() === cvPath);
check('and the profile now carries the details from the form', (await sql('select full_name from profiles where id = $1', [freshId]))[0]?.full_name === 'مرشح تجريبي');

// A dropped connection: the request leaves, the phone gives up before the answer.
const controller = new AbortController();
const dropped = action(token, 'applyToJob', application(jobB.id), { signal: controller.signal }).catch((error) => ({ status: 0, json: { aborted: error.name } }));
await sleep(30);
controller.abort();
const droppedResult = await dropped;
check('the dropped request never got its answer', droppedResult.status === 0 || ok(droppedResult), describe(droppedResult));
await sleep(1500);
const retried = await action(token, 'applyToJob', application(jobB.id));
check('trying again either sends it or says it already went', ok(retried) || refused(retried, 'already_applied'), describe(retried));
check('either way there is exactly one application', (await sql('select 1 from applications where candidate_id = $1 and job_id = $2', [freshId, jobB.id])).length === 1);

// A slow line: the body trickles in over a few seconds.
const slowBody = new TextEncoder().encode(JSON.stringify({ input: application(jobC.id) }));
const trickle = new ReadableStream({
  async start(stream) {
    const step = Math.ceil(slowBody.length / 6);
    for (let at = 0; at < slowBody.length; at += step) {
      stream.enqueue(slowBody.slice(at, at + step));
      await sleep(500);
    }
    stream.close();
  },
});
const started = Date.now();
const slow = await action(token, 'applyToJob', null, { body: trickle });
check(`an application that took ${((Date.now() - started) / 1000).toFixed(1)}s to arrive is sent`, ok(slow), describe(slow));
check('and recorded once', (await sql('select 1 from applications where candidate_id = $1 and job_id = $2', [freshId, jobC.id])).length === 1);

const notJson = await action(token, 'applyToJob', null, { body: '{"input": {"jobId": ' });
check('a body cut off half way is a 400, not a crash', notJson.status === 400, describe(notJson));

const withdrawn = await action(token, 'withdrawApplication', { applicationId: (await sql('select id from applications where candidate_id = $1 and job_id = $2', [freshId, jobC.id]))[0]?.id });
check('an application is withdrawn', ok(withdrawn), describe(withdrawn));
const withdrawnAgain = await action(token, 'withdrawApplication', { applicationId: randomUUID() });
check('withdrawing one that is not there is refused, not reported done', refused(withdrawnAgain, 'forbidden'), describe(withdrawnAgain));

// Saving: two taps on the bookmark at once settle on one state, not two rows.
const taps = await Promise.all([action(token, 'toggleSavedJob', { jobId: jobD.id }), action(token, 'toggleSavedJob', { jobId: jobD.id })]);
check('two taps on the bookmark both answer', taps.every((r) => r.status === 200), taps.map(describe));
check('and leave at most one saved row', (await sql('select count(*)::int as n from saved_jobs where candidate_id = $1 and job_id = $2', [freshId, jobD.id]))[0].n <= 1);
const searchTwice = await Promise.all([
  action(token, 'saveSearch', { query: 'track=resale', label: 'ريسيل (edge)' }),
  action(token, 'saveSearch', { query: 'track=resale', label: 'ريسيل (edge)' }),
]);
check('the same search saved twice at once is kept once', (await sql("select count(*)::int as n from saved_searches where candidate_id = $1 and query = 'track=resale'", [freshId]))[0].n === 1, searchTwice.map(describe));
const emptySearch = await action(token, 'saveSearch', { query: '', label: 'لا شيء' });
check('a search with no filters is refused', refused(emptySearch), describe(emptySearch));

// Reports: once is a report, twice is the same report.
const report = await action(token, 'reportTarget', { target: 'job', targetId: jobD.id, reason: 'scam' });
check('a listing is reported', ok(report), describe(report));
const reportAgain = await action(token, 'reportTarget', { target: 'job', targetId: jobD.id, reason: 'scam' });
check('reporting it again is the same report', refused(reportAgain, 'already_reported'), describe(reportAgain));
check('one report row', (await sql('select count(*)::int as n from reports where reporter_id = $1 and job_id = $2', [freshId, jobD.id]).catch(() => [{ n: -1 }]))[0].n === 1);

// ---------------------------------------------------------------------------
section('sessions: returning, refreshed, signed out elsewhere, expired, forged');

const returning = await signIn(candidateEmail, candidatePassword);
check('the candidate comes back and signs in', returning.status === 200 && returning.token, describe(returning));
const refreshedResponse = await fetch(`${SUPABASE}/auth/v1/token?grant_type=refresh_token`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({ refresh_token: returning.refresh }),
});
const refreshed = await refreshedResponse.json().catch(() => ({}));
check('the session refreshes', refreshedResponse.status === 200 && refreshed.access_token, `${refreshedResponse.status}`);
const withRefreshed = await action(refreshed.access_token, 'toggleSavedJob', { jobId: jobD.id });
check('and the refreshed token writes', ok(withRefreshed), describe(withRefreshed));

const wrongPassword = await signIn(candidateEmail, `${candidatePassword}x`);
check('a wrong password is refused without a session', wrongPassword.status === 400 && !wrongPassword.token, describe(wrongPassword));
const unknown = await signIn(`nobody-${stamp}@example.com`, candidatePassword);
check('an unknown address is refused the same way', unknown.status === 400 && !unknown.token, describe(unknown));

// Signed out on another device: GoTrue's default scope ends every session.
const logout = await fetch(`${SUPABASE}/auth/v1/logout`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${returning.token}` } });
check('signing out answers', logout.status === 204, `${logout.status}`);
const afterLogout = await action(refreshed.access_token, 'toggleSavedJob', { jobId: jobD.id });
check('a token from a signed-out session is a 401 at the door', afterLogout.status === 401, describe(afterLogout));
const deadRefresh = await fetch(`${SUPABASE}/auth/v1/token?grant_type=refresh_token`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({ refresh_token: refreshed.refresh_token }),
});
check('and its refresh token is dead', deadRefresh.status >= 400, `${deadRefresh.status}`);

const forged = `${returning.token.slice(0, returning.token.lastIndexOf('.'))}.${'A'.repeat(43)}`;
const forgedAction = await action(forged, 'toggleSavedJob', { jobId: jobD.id });
check('a token with a forged signature is a 401', forgedAction.status === 401, describe(forgedAction));
const forgedRest = await rest(forged, 'profiles?select=id');
check('and PostgREST refuses it too', forgedRest.status === 401, describe(forgedRest));
const garbage = await fetch(`${SITE}/api/mobile/v1/actions/toggleSavedJob`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${ANON}x` },
  body: JSON.stringify({ input: { jobId: jobD.id } }),
});
check('a bearer that is not a token is a 401', garbage.status === 401, `${garbage.status}`);

if (JWT_SECRET) {
  const expired = mintToken({
    sub: freshId,
    role: 'authenticated',
    aud: 'authenticated',
    email: candidateEmail,
    exp: Math.floor(Date.now() / 1000) - 60,
    iat: Math.floor(Date.now() / 1000) - 3660,
  });
  const expiredAction = await action(expired, 'toggleSavedJob', { jobId: jobD.id });
  check('an expired token is a 401 at the door, so the app refreshes', expiredAction.status === 401, describe(expiredAction));
  const expiredRest = await rest(expired, 'profiles?select=id');
  check('and PostgREST refuses it too', expiredRest.status === 401, describe(expiredRest));
} else {
  console.log('  SKIP  an expired token (no SUPABASE_JWT_SECRET)');
}

// A password changed: the old one stops working, the new one starts.
const again = await signIn(candidateEmail, candidatePassword);
token = again.token;
const newPassword = `E2e-${randomUUID()}`;
const changed = await fetch(`${SUPABASE}/auth/v1/user`, {
  method: 'PUT',
  headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ password: newPassword }),
});
check('the password changes', changed.status === 200, `${changed.status}`);
const announced = await action(token, 'announcePasswordChange', {});
check('and the server is told', ok(announced), describe(announced));
check('the old password no longer signs in', (await signIn(candidateEmail, candidatePassword)).status === 400);
const withNew = await signIn(candidateEmail, newPassword);
check('the new one does', withNew.status === 200 && withNew.token);
made[0].password = newPassword;
token = withNew.token;

// ---------------------------------------------------------------------------
section('a fresh employer: the company, the empty console, a listing posted twice');

const employerEmail = `e2e-edge-${stamp}-e@example.com`;
const employerPassword = `E2e-${randomUUID()}`;
const employerSignup = await signUp(employerEmail, employerPassword);
const employerId = employerSignup.user?.id;
made.push({ email: employerEmail, password: employerPassword, id: employerId });
let employerToken = employerSignup.token;
check('an employer signs up', employerSignup.status === 200 && employerToken);

const employerBase = { role: 'employer', fullName: 'صاحب شركة', whatsapp: '+201221112233', locale: 'ar', agreed: true };
const scriptSite = await action(employerToken, 'completeOnboarding', { ...employerBase, company: { nameAr: 'شركة الاختبار', website: 'javascript:alert(1)' } });
check('a company website that is not http(s) is refused, under its own field', refused(scriptSite, 'invalid') && scriptSite.json?.fieldErrors?.companyWebsite === 'invalidUrl', describe(scriptSite));
check('and nothing was created', (await sql('select 1 from profiles where id = $1', [employerId])).length === 0);
const companyName = `شركة الحافة ${stamp}`;
const onboarded = await Promise.all([
  action(employerToken, 'completeOnboarding', { ...employerBase, company: { nameAr: companyName, website: 'https://example.com', headcountBand: '11_50' } }),
  action(employerToken, 'completeOnboarding', { ...employerBase, company: { nameAr: companyName, website: 'https://example.com', headcountBand: '11_50' } }),
]);
check('the employer onboards (sent twice at once)', onboarded.some(ok), onboarded.map(describe));
const companies = await sql('select id, slug, website from companies where owner_id = $1', [employerId]);
check('one company, not two', companies.length === 1, companies);
check('the website is stored as a real link', companies[0]?.website?.startsWith('https://example.com'), companies[0]);
const [employerProfile] = await sql('select role, approval_status from profiles where id = $1', [employerId]);
check('the account is an employer, held for review', employerProfile?.role === 'employer' && employerProfile?.approval_status === 'pending', employerProfile);
const companyId = companies[0]?.id;
check('their membership is admin', (await sql('select role from company_members where company_id = $1 and user_id = $2', [companyId, employerId]))[0]?.role === 'admin');

const consoleJobs = await rest(employerToken, `jobs?select=id&company_id=eq.${companyId}`);
check('the empty console lists no listings', consoleJobs.status === 200 && consoleJobs.json?.length === 0, describe(consoleJobs));
const consoleApplicants = await rest(employerToken, 'applications?select=id');
check('and no applicants', consoleApplicants.status === 200 && consoleApplicants.json?.length === 0, describe(consoleApplicants));

const district = (await sql('select id from districts order by id limit 1'))[0]?.id;
const listing = {
  titleAr: 'استشاري مبيعات (edge)',
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
  submit: false,
};
const listingErrors = [
  ['a salary whose top is below its bottom', { basicSalaryMin: 20000, basicSalaryMax: 10000 }, 'basicSalaryMax'],
  ['a percentage commission with no percentage', { commissionValue: null }, 'commissionValue'],
  ['a description of a few words', { descriptionAr: 'وظيفة' }, 'descriptionAr'],
  ['a two-letter title', { titleAr: 'ab' }, 'titleAr'],
  ['zero seats', { seats: 0 }, 'seats'],
  [
    'a description that is mostly links',
    { descriptionAr: 'قدّم هنا https://a.example https://b.example https://c.example https://d.example https://e.example https://f.example' },
    'descriptionAr',
  ],
];
// Held for review: the console says so (employer/jobs/new), and the database
// refuses a listing from an account nobody has approved yet.
const tooEarly = await action(employerToken, 'saveJob', { ...listing, idempotencyKey: randomUUID() });
check('an employer still under review cannot save a listing', refused(tooEarly), describe(tooEarly));
check('and nothing was written', (await sql('select 1 from jobs where company_id = $1', [companyId])).length === 0);

// The admin console's approve button: set_account_approval, as the admin.
const admin = await signIn('admin@demo.test');
const approval = await rest(admin.token, 'rpc/set_account_approval', {
  method: 'POST',
  body: { p_user: employerId, p_status: 'approved', p_note: null },
});
check('an admin approves the employer', approval.status < 300, describe(approval));
check('and the account is approved', (await sql('select approval_status from profiles where id = $1', [employerId]))[0]?.approval_status === 'approved');
check('the decision is in the audit log', (await sql("select 1 from admin_audit_log where target_id::text = $1", [employerId]).catch(() => [])).length >= 1);

for (const [label, change, field] of listingErrors) {
  const result = await action(employerToken, 'saveJob', { ...listing, ...change, idempotencyKey: randomUUID() });
  check(`a listing with ${label} is refused, naming the field`, refused(result, 'invalid') && field in (result.json?.fieldErrors ?? {}), describe(result));
}
check('and none of them made a listing', (await sql('select 1 from jobs where company_id = $1', [companyId])).length === 0);

const key = randomUUID();
const posts = await Promise.all([1, 2, 3].map(() => action(employerToken, 'saveJob', { ...listing, idempotencyKey: key })));
const ids = new Set(posts.filter(ok).map((r) => r.json?.data?.id));
check('three saves of one draft at once converge on one listing', posts.every(ok) && ids.size === 1, posts.map(describe));
const jobRows = await sql('select id, status, version from jobs where company_id = $1', [companyId]);
check('one row in the database, a draft', jobRows.length === 1 && jobRows[0].status === 'draft', jobRows);
const draftId = jobRows[0]?.id;

const controller2 = new AbortController();
const droppedPost = action(employerToken, 'saveJob', { ...listing, id: draftId, version: jobRows[0]?.version, submit: true, idempotencyKey: key }, { signal: controller2.signal }).catch(() => ({ status: 0 }));
await sleep(30);
controller2.abort();
await droppedPost;
await sleep(1500);
const [current] = await sql('select status, version from jobs where id = $1', [draftId]);
const submitted = await action(employerToken, 'saveJob', { ...listing, id: draftId, version: current?.version, submit: true, idempotencyKey: key });
check('submitting after a dropped attempt goes through', ok(submitted) && submitted.json?.data?.id === draftId, describe(submitted));
const [pending] = await sql('select status from jobs where id = $1', [draftId]);
check('the listing waits for review', pending?.status === 'pending_review', pending);
check('still one listing', (await sql('select 1 from jobs where company_id = $1', [companyId])).length === 1);

const stale = await action(employerToken, 'saveJob', { ...listing, id: draftId, version: 1, titleAr: 'عنوان من نسخة قديمة', submit: true });
const [afterStale] = await sql('select title_ar from jobs where id = $1', [draftId]);
check('an edit from an out-of-date form does not overwrite a newer one', afterStale?.title_ar === listing.titleAr || refused(stale), `${describe(stale)} ${afterStale?.title_ar}`);

const toActive = await action(employerToken, 'transitionJob', { jobId: draftId, status: 'active' });
check('an employer cannot publish their own listing', refused(toActive, 'invalid'), describe(toActive));
const demo = await signIn('employer1@demo.test');
const othersClose = await action(demo.token, 'transitionJob', { jobId: draftId, status: 'closed' });
check('another company cannot close it', refused(othersClose, 'forbidden'), describe(othersClose));
// In review a listing can be taken back to a draft, not closed: the consoles
// offer "close" only on a live listing (job-status-actions.tsx), and the
// database holds the same rule (guard_job_update).
const closedInReview = await action(employerToken, 'transitionJob', { jobId: draftId, status: 'closed' });
check('a listing in review cannot be closed', refused(closedInReview, 'invalid_transition'), describe(closedInReview));
const publicView = await rest(null, `jobs?select=id&id=eq.${draftId}`);
check('the public cannot see it while it waits', Array.isArray(publicView.json) && publicView.json.length === 0, describe(publicView));

// The moderator publishes it; it goes live; its own company closes it.
const published = await rest(admin.token, 'rpc/admin_moderate_job', {
  method: 'POST',
  body: { p_job: draftId, p_action: 'approve', p_reason: null },
});
check('an admin publishes the listing', published.status < 300, describe(published));
const [live] = await sql('select status, published_at, expires_at from jobs where id = $1', [draftId]);
check('it is live, with a publication date and an expiry', live?.status === 'active' && live?.published_at && live?.expires_at, live);
const liveRead = await read(`jobs?company=${encodeURIComponent(companies[0]?.slug ?? '')}`);
check('and on the public board', (liveRead.json?.jobs ?? []).some((job) => job.id === draftId), describe(liveRead));
const closed = await action(employerToken, 'transitionJob', { jobId: draftId, status: 'closed' });
check('its own company closes it', ok(closed), describe(closed));
check('and the row says closed', (await sql('select status from jobs where id = $1', [draftId]))[0]?.status === 'closed');
const boardAfter = await read(`jobs?company=${encodeURIComponent(companies[0]?.slug ?? '')}`);
check('it leaves the board', !(boardAfter.json?.jobs ?? []).some((job) => job.id === draftId), describe(boardAfter));

const team = await action(employerToken, 'addCompanyMember', { email: `nobody-${stamp}@example.com`, role: 'recruiter' });
check('adding a colleague with no account says so', refused(team, 'no_account'), describe(team));
const teamCandidate = await action(employerToken, 'addCompanyMember', { email: candidateEmail, role: 'recruiter' });
check('a candidate account cannot be made a colleague', refused(teamCandidate), describe(teamCandidate));
check('no membership was written for them', (await sql('select 1 from company_members where user_id = $1', [freshId])).length === 0);

const ownerDelete = await action(employerToken, 'deleteMyAccount', {});
check('an owner cannot delete their account out from under the company', refused(ownerDelete, 'owns_company'), describe(ownerDelete));
check('and is still there', (await sql('select 1 from auth.users where id = $1', [employerId])).length === 1);
const requestKey = randomUUID();
const deletionRequest = await action(employerToken, 'requestAccountDeletion', { key: requestKey });
check('they can ask instead, and get a reference', ok(deletionRequest) && typeof deletionRequest.json?.data?.reference === 'string', describe(deletionRequest));
const deletionRetry = await action(employerToken, 'requestAccountDeletion', { key: requestKey });
check('asking again with the same key is the same request', ok(deletionRetry) && deletionRetry.json?.data?.reference === deletionRequest.json?.data?.reference, describe(deletionRetry));
const candidateRequest = await action(token, 'requestAccountDeletion', { key: randomUUID() });
check('a candidate is told to delete it themselves', refused(candidateRequest, 'not_owner'), describe(candidateRequest));

// ---------------------------------------------------------------------------
section('the candidate leaves: the account and what hangs off it');

const before = {
  applications: (await sql('select count(*)::int as n from applications where candidate_id = $1', [freshId]))[0].n,
  files: (await sql("select count(*)::int as n from storage.objects where bucket_id in ('cvs', 'avatars') and name like $1", [`${freshId}/%`]))[0].n,
};
check('there is something to delete (applications and files)', before.applications > 0 && before.files > 0, before);
const goodbye = await action(token, 'deleteMyAccount', {});
check('the candidate deletes their account', ok(goodbye), describe(goodbye));
check('the auth user is gone', (await sql('select 1 from auth.users where id = $1', [freshId])).length === 0);
check('the profile is gone', (await sql('select 1 from profiles where id = $1', [freshId])).length === 0);
check('the directory card is gone', (await sql('select 1 from agent_profiles where user_id = $1', [freshId])).length === 0);
check('the applications are gone', (await sql('select 1 from applications where candidate_id = $1', [freshId])).length === 0);
const files = await eventually(
  () => sql("select name from storage.objects where bucket_id in ('cvs', 'avatars') and name like $1", [`${freshId}/%`]),
  (rows) => rows.length === 0,
);
check('the CV and the photo are gone from storage', files.length === 0, files);
check('and the address no longer signs in', (await signIn(candidateEmail, newPassword)).status === 400);
const ghost = await action(token, 'toggleSavedJob', { jobId: jobD.id });
check('the deleted account’s last token opens nothing', ghost.status === 401, describe(ghost));
made.shift();

// ---------------------------------------------------------------------------
// The employer this run made owns a company, so the product will not let it go
// (owns_company, above). It goes the way an operator would: through the
// database, company first.
for (const account of made) {
  if (!account.id) continue;
  await sql('delete from companies where owner_id = $1', [account.id]).catch(() => {});
  await sql('delete from auth.users where id = $1', [account.id]).catch(() => {});
}

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
