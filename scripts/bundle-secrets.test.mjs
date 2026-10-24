/**
 * The bundle scanner CI runs over the app's export and the website's static
 * output: it must name each kind of server secret, and it must pass what a
 * bundle is allowed to carry.
 *
 *   pnpm test:bundle-secrets
 *
 * Every fixture is assembled at run time from pieces, so this file holds no
 * string that looks like a credential — the repository's own secret scan
 * reads it too.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from './bundle-secrets.mjs';

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

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.${'s'.repeat(43)}`;
const filler = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';

function bundleWith(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  mkdirSync(join(dir, '_expo', 'static', 'js'), { recursive: true });
  writeFileSync(join(dir, '_expo', 'static', 'js', 'index.js'), `var config = ${JSON.stringify(contents)};`);
  return dir;
}

function verdict(contents) {
  const dir = bundleWith(contents);
  try {
    return scan([dir]).map((finding) => finding.rule);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n— what a bundle may carry');
{
  const publicOnly = {
    url: 'https://hiwdhicwsohbipxzazmb.supabase.co',
    key: ['sb', 'publishable', filler].join('_'),
    legacyAnon: jwt({ iss: 'supabase', ref: 'abc', role: 'anon' }),
    site: 'https://www.brokersconnect.net',
    docs: 'postgres://host/db without a password is just text',
  };
  const found = verdict(publicOnly);
  check('the publishable key, an anon JWT and public URLs pass', found.length === 0, found.join(', '));
}

console.log('\n— what it must never carry');
{
  const cases = [
    ['Supabase secret key (sb_secret_)', ['sb', 'secret', filler].join('_')],
    ['service-role JWT', jwt({ iss: 'supabase', ref: 'abc', role: 'service_role' })],
    ['database URL with a password', `${'postgres'}ql://postgres.ref:${filler}@aws-0-eu.pooler.supabase.com:6543/postgres`],
    ['private key', `-----BEGIN ${'PRIVATE'} KEY-----\nMIGT\n-----END PRIVATE KEY-----`],
    ['webhook signing secret (whsec_)', `${'whsec'}_${filler}`],
    ['Resend API key', `${'re'}_${filler.slice(0, 8)}_${filler}`],
  ];
  for (const [rule, value] of cases) {
    const found = verdict({ leaked: value });
    check(`refuses: ${rule}`, found.includes(rule), found.join(', ') || 'nothing found');
  }
}

console.log('\n— a finding names the file, never the value');
{
  const value = ['sb', 'secret', filler].join('_');
  const dir = bundleWith({ leaked: value });
  try {
    const findings = scan([dir]);
    check('the file is named', findings.length === 1 && findings[0].file.endsWith('index.js'));
    check('the value is not in the finding', !JSON.stringify(findings).includes(filler));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
