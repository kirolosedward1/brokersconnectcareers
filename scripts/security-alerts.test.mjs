/**
 * What a security alert and the weekly digest tell an admin.
 *
 *   pnpm test:security-alerts
 *
 * The watcher (api/cron/security-watch) sends these; the words are decided in
 * src/lib/security/alerts.ts, held here. Identifiers, never content: an alert
 * names the kind, the time and the account behind it by id, and leaves the
 * rest to /admin/security.
 */
import { readFileSync } from 'node:fs';
const { alertBlocks, digestBlocks, isoWeek } = await import('../src/lib/security/alerts.ts');
const { emailCopy } = await import('../src/lib/email/copy.ts');

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

const SITE = 'https://www.brokersconnect.net';
const text = (blocks) => JSON.stringify(blocks);

console.log('— an alert');
{
  const madeAdmin = {
    id: 7,
    kind: 'account.made_admin',
    created_at: '2026-10-24T10:00:00Z',
    actor_id: null,
    metadata: { target: '0b7c1a44-0000-4000-8000-000000000001', path: 'direct' },
  };
  for (const locale of ['ar', 'en']) {
    const c = emailCopy[locale];
    const blocks = alertBlocks(madeAdmin, c, locale, SITE);
    check(`${locale}: a new admin says what to do (runbook A2)`, blocks[0].kind === 'security' && blocks[0].value === c.securityAlert.madeAdmin && /A2/.test(blocks[0].value));
    check(`${locale}: and how it was done — straight in the database`, text(blocks).includes(c.securityAlert.direct));
    check(`${locale}: the time in Cairo, in Western digits`, /\d/.test(blocks[1].rows[1][1]) && !/[٠-٩]/.test(blocks[1].rows[1][1]));
    check(`${locale}: and opens the security page, on our own site`, blocks.at(-1).href === `${SITE}/admin/security`);
  }
  const other = alertBlocks(
    { id: 8, kind: 'upload.malicious_reported', created_at: '2026-10-24T10:00:00Z', actor_id: 'u1', metadata: { bucket: 'cvs' } },
    emailCopy.en,
    'en',
    SITE,
  );
  check('another critical event reads as one, by its kind and its actor id', other[0].value === emailCopy.en.securityAlert.body && text(other).includes('upload.malicious_reported') && text(other).includes('u1'));
  check('and carries nothing of the metadata beyond the path', !text(other).includes('cvs'));
}

console.log('— the digest');
{
  const digest = {
    days: 7,
    auth_failures: 41,
    rate_limited: 3,
    uploads_rejected: 1,
    critical: 1,
    warnings: 9,
    reveals: 120,
    reveals_by_company: [{ company: 'شركة النيل', count: 90 }],
    new_admins: [{ at: '2026-10-22T10:00:00Z', name: 'منى', path: 'session' }],
    admins_now: 2,
  };
  const blocks = digestBlocks(digest, emailCopy.ar, SITE);
  check('the numbers are all there', ['41', '3', '1', '120', '2'].every((n) => text(blocks).includes(`"${n}"`)));
  check('reveals per company', text(blocks).includes('شركة النيل') && text(blocks).includes('"90"'));
  check('a new admin this week is flagged, not just counted', blocks.some((b) => b.kind === 'security' && b.value === emailCopy.ar.securityDigest.newAdmins(1)));
  check('says where the firewall blocks are, since the database does not hold them', text(blocks).includes(emailCopy.ar.securityDigest.firewall));
  const quiet = digestBlocks({ ...digest, reveals_by_company: [], new_admins: [] }, emailCopy.en, SITE);
  check('a quiet week says no new admin', quiet.some((b) => b.kind === 'text' && b.value === emailCopy.en.securityDigest.noNewAdmins));
}

console.log('— once a week');
{
  check('a Monday and the Sunday before are different weeks', isoWeek(new Date('2026-10-26T06:10:00Z')) !== isoWeek(new Date('2026-10-25T23:00:00Z')));
  check('Monday and the Sunday after are the same week', isoWeek(new Date('2026-10-26T06:10:00Z')) === isoWeek(new Date('2026-11-01T22:00:00Z')));
  check('named the ISO way', isoWeek(new Date('2026-10-26T06:10:00Z')) === '2026-W44', isoWeek(new Date('2026-10-26T06:10:00Z')));
  check('the first days of January can belong to the last week of the year before', isoWeek(new Date('2027-01-01T12:00:00Z')) === '2026-W53', isoWeek(new Date('2027-01-01T12:00:00Z')));
}

console.log('— the watcher');
{
  const route = readFileSync(new URL('../src/app/api/cron/security-watch/route.ts', import.meta.url), 'utf8');
  check('runs only with the cron secret (runScheduledJob)', /return runScheduledJob\(request, \{\s*job: 'security-watch'/.test(route));
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  check('is scheduled every ten minutes', vercel.crons.some((cron) => cron.path === '/api/cron/security-watch' && cron.schedule === '*/10 * * * *'));
  const health = readFileSync(new URL('../src/app/api/health/route.ts', import.meta.url), 'utf8');
  check('and /api/health notices when it stops', health.includes("'security-watch': 30 * 60 * 1000"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
