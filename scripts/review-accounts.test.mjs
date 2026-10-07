/**
 * scripts/review-accounts.mjs without a network: its parts, and that it
 * refuses before reaching anything. What it writes is
 * supabase/review-accounts.sql, tested on the real migrations in
 * supabase/tests/review-accounts.test.mjs.
 *
 *   node scripts/review-accounts.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clearFactors, liveCvCheck, newPassword, parseArgs, projectRef, samplePdf } from './review-accounts.mjs';

let pass = 0;
let fail = 0;
function check(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('— the target');
check('a Supabase URL names its project', projectRef('https://hiwdhicwsohbipxzazmb.supabase.co') === 'hiwdhicwsohbipxzazmb');
check('a local stack is named by its host', projectRef('http://127.0.0.1:54321') === '127.0.0.1:54321');

console.log('— the arguments');
check('reads only by default', JSON.stringify(parseArgs([])) === JSON.stringify({ execute: false, remove: false, confirm: null }));
check(
  'executes, removes, and is confirmed by name',
  JSON.stringify(parseArgs(['--remove', '--execute', '--confirm', 'abc'])) ===
    JSON.stringify({ execute: true, remove: true, confirm: 'abc' }),
);
let unknown = null;
try {
  parseArgs(['--yes']);
} catch (error) {
  unknown = error.message;
}
check('refuses an argument it does not know', /Unknown argument: --yes/.test(unknown ?? ''), unknown);

console.log('— the passwords');
const passwords = Array.from({ length: 20 }, () => newPassword());
check('each is new', new Set(passwords).size === passwords.length);
check(
  'each is long and has every kind of character a policy can ask for',
  passwords.every((p) => p.length >= 20 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p)),
);
check("and none breaks the quotes it is printed in", passwords.every((p) => !p.includes("'")));
// The employer's is typed from the review notes, on a phone.
check(
  'and none has a character that passes for another (0 O o, 1 l I, - _)',
  passwords.every((p) => !/[0Oo1lI_]/.test(p)),
  passwords.find((p) => /[0Oo1lI_]/.test(p)),
);

console.log('— a two-step code a reviewer turned on');
{
  const asked = [];
  const call = async (path, options = {}) => {
    asked.push(`${options.method ?? 'GET'} ${path}`);
    return null;
  };
  await clearFactors(call, { id: 'u1', factors: [{ id: 'f1' }, { id: 'f2' }] });
  check(
    'is taken off, so the next reviewer signs in with the password alone',
    JSON.stringify(asked) === JSON.stringify(['DELETE /auth/v1/admin/users/u1/factors/f1', 'DELETE /auth/v1/admin/users/u1/factors/f2']),
    JSON.stringify(asked),
  );
  asked.length = 0;
  await clearFactors(call, { id: 'u2' });
  check('and an account with none is left alone', asked.length === 0, JSON.stringify(asked));
}

console.log("— the employer opening the applicant's CV on the live site");
{
  const answers = (cv) => async (url, init = {}) => {
    const href = String(url);
    if (href.includes('/auth/v1/token')) {
      return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    }
    if (href.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    if (href.includes('/api/cv/')) {
      if (init.headers?.Authorization !== 'Bearer token' || init.headers?.Accept !== 'application/json') {
        return new Response('{}', { status: 401 });
      }
      return cv();
    }
    throw new Error(`unexpected ${href}`);
  };
  const base = { site: 'https://www.example.test', supabaseUrl: 'https://abc.supabase.co', apikey: 'service', email: 'e@x.test', password: 'p', applicationId: 'a1' };
  const works = await liveCvCheck({ ...base, fetchImpl: answers(() => new Response(JSON.stringify({ url: 'https://signed' }), { status: 200 })) });
  check('works when the website hands out the link', works.ok === true, JSON.stringify(works));
  const broken = await liveCvCheck({ ...base, fetchImpl: answers(() => new Response(JSON.stringify({ error: 'unavailable' }), { status: 500 })) });
  check(
    'says so when it cannot, naming the key the website needs',
    broken.ok === false && /500/.test(broken.reason) && /SUPABASE_SERVICE_ROLE_KEY/.test(broken.reason),
    JSON.stringify(broken),
  );
  const unreachable = await liveCvCheck({ ...base, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  check('and that it could not ask, when nothing answers', unreachable.ok === false && /no answer/.test(unreachable.reason), JSON.stringify(unreachable));
}

console.log('— the CV');
const pdf = samplePdf().toString('latin1');
check('is a PDF', pdf.startsWith('%PDF-1.4\n') && pdf.endsWith('%%EOF\n'));
const xrefAt = Number(pdf.match(/startxref\n(\d+)\n%%EOF\n$/)?.[1]);
check('its cross-reference table is where it says', pdf.slice(xrefAt).startsWith('xref\n'), String(xrefAt));
const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
check(
  'and each object is where the table says',
  offsets.length === 5 && offsets.every((at, index) => pdf.slice(at).startsWith(`${index + 1} 0 obj\n`)),
  JSON.stringify(offsets),
);
const length = Number(pdf.match(/\/Length (\d+)/)?.[1]);
const stream = pdf.match(/stream\n([\s\S]*?)\nendstream/)?.[1] ?? '';
check("its page's length is its content's", length === stream.length, `${length} vs ${stream.length}`);

console.log('— refusing before anything is reached');
const script = fileURLToPath(new URL('./review-accounts.mjs', import.meta.url));
const ENV = {
  PATH: process.env.PATH,
  NEXT_PUBLIC_SUPABASE_URL: 'https://hiwdhicwsohbipxzazmb.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-the-test',
  TARGET_DATABASE_URL: 'postgresql://postgres.hiwdhicwsohbipxzazmb:x@127.0.0.1:1/postgres',
  REVIEW_CANDIDATE_EMAIL: 'candidate@example.com',
  REVIEW_EMPLOYER_EMAIL: 'employer@example.com',
};
const runScript = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { env: { ...ENV, ...env }, encoding: 'utf8' });

const unconfirmed = runScript(['--execute']);
check(
  'writes nothing without --confirm and the project',
  unconfirmed.status === 1 && /add --confirm hiwdhicwsohbipxzazmb/.test(unconfirmed.stderr),
  unconfirmed.stderr,
);
const wrong = runScript(['--execute', '--confirm', 'someotherproject1234']);
check('nor with another project named', wrong.status === 1 && /add --confirm hiwdhicwsohbipxzazmb/.test(wrong.stderr), wrong.stderr);
const split = runScript(['--execute', '--confirm', 'hiwdhicwsohbipxzazmb'], {
  TARGET_DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:x@127.0.0.1:1/postgres',
});
check(
  "refuses a database that is not the project's",
  split.status === 1 && /is not hiwdhicwsohbipxzazmb's database/.test(split.stderr),
  split.stderr,
);
const same = runScript([], { REVIEW_EMPLOYER_EMAIL: 'Candidate@example.com' });
check('refuses one address for both accounts', same.status === 1 && /must be two addresses/.test(same.stderr), same.stderr);
const badPhone = runScript([], { REVIEW_PHONE: '01001234567' });
check('refuses a number not in international form', badPhone.status === 1 && /international form/.test(badPhone.stderr), badPhone.stderr);
const missing = runScript([], { REVIEW_EMPLOYER_EMAIL: '' });
check('names a missing address', missing.status === 1 && /Missing REVIEW_EMPLOYER_EMAIL/.test(missing.stderr), missing.stderr);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
