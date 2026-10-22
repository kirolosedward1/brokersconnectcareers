/**
 * Whether a listing is live, what status it shows, and who may open it
 * (job-state.ts).
 *
 *   pnpm test:job-state
 *
 * The stored status lags the truth: the nightly expiry flips `active` to
 * `expired` after the fact, and on a night it does not run the label stays
 * `active` indefinitely. The board, the apply page and the employer's console
 * all ask these three functions instead of the label, so a listing past its
 * date cannot take applications or show as published, whatever the cron did.
 */
import { jobIsLive, displayJobStatus, jobIsPublic } from '../src/lib/job-state.ts';

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

const HOUR = 3600_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();

const STATUSES = ['draft', 'pending_review', 'active', 'rejected', 'expired', 'closed'];

console.log('\n— live');
{
  check('active, expiring next week', jobIsLive({ status: 'active', expires_at: ahead(7 * 24 * HOUR) }));
  check('active, with no expiry', jobIsLive({ status: 'active', expires_at: null }));
  check('active, but its date passed an hour ago — the cron has not run', !jobIsLive({ status: 'active', expires_at: ago(HOUR) }));
  check('active, but its date passed a second ago', !jobIsLive({ status: 'active', expires_at: ago(1000) }));
  for (const status of STATUSES.filter((s) => s !== 'active')) {
    check(`${status} is never live, even with a future date`, !jobIsLive({ status, expires_at: ahead(HOUR) }));
  }
}

console.log('\n— the status shown');
{
  check('an active listing past its date shows as expired',
    displayJobStatus({ status: 'active', expires_at: ago(HOUR) }) === 'expired');
  check('a live one shows as active',
    displayJobStatus({ status: 'active', expires_at: ahead(HOUR) }) === 'active');
  for (const status of STATUSES.filter((s) => s !== 'active')) {
    check(`${status} shows as itself, whatever the date`,
      displayJobStatus({ status, expires_at: ago(HOUR) }) === status && displayJobStatus({ status, expires_at: null }) === status);
  }
}

console.log('\n— who can open it');
{
  // The labels jobs_select_active lets an anonymous visitor read.
  for (const status of ['active', 'expired', 'closed']) {
    check(`${status}: anybody can open the page`, jobIsPublic({ status }));
  }
  // The company's own business: 404 to everybody else.
  for (const status of ['draft', 'pending_review', 'rejected']) {
    check(`${status}: nobody outside the company can`, !jobIsPublic({ status }));
  }
  check('every status is decided one way or the other',
    STATUSES.every((status) => typeof jobIsPublic({ status }) === 'boolean'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
