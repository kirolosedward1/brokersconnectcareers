/**
 * scripts/remove-demo.mjs without a network: it refuses before reaching
 * anything. What it deletes is supabase/remove-demo.sql, tested on the real
 * migrations in supabase/tests/remove-demo.test.mjs.
 *
 *   node scripts/remove-demo.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const script = fileURLToPath(new URL('./remove-demo.mjs', import.meta.url));
const ENV = {
  PATH: process.env.PATH,
  NEXT_PUBLIC_SUPABASE_URL: 'https://hiwdhicwsohbipxzazmb.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-the-test',
  TARGET_DATABASE_URL: 'postgresql://postgres.hiwdhicwsohbipxzazmb:x@127.0.0.1:1/postgres',
};
const runScript = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { env: { ...ENV, ...env }, encoding: 'utf8' });

console.log('— refusing before anything is reached');
const unconfirmed = runScript(['--execute']);
check(
  'deletes nothing without --confirm and the project',
  unconfirmed.status === 1 && /add --confirm hiwdhicwsohbipxzazmb/.test(unconfirmed.stderr),
  unconfirmed.stderr,
);
const wrong = runScript(['--execute', '--confirm', 'someotherproject1234']);
check('nor with another project named', wrong.status === 1 && /add --confirm hiwdhicwsohbipxzazmb/.test(wrong.stderr), wrong.stderr);
const split = runScript(['--execute', '--confirm', 'hiwdhicwsohbipxzazmb'], {
  TARGET_DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:x@127.0.0.1:1/postgres',
});
check("refuses a database that is not the project's", split.status === 1 && /is not hiwdhicwsohbipxzazmb's database/.test(split.stderr), split.stderr);
const remove = runScript(['--remove']);
check('takes no --remove: removing is all it does', remove.status === 1 && /only removes/.test(remove.stderr), remove.stderr);
const missing = runScript([], { SUPABASE_SERVICE_ROLE_KEY: '' });
check('names a missing key', missing.status === 1 && /Missing SUPABASE_SERVICE_ROLE_KEY/.test(missing.stderr), missing.stderr);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
