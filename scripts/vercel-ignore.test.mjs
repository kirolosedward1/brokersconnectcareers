/**
 * When Vercel builds the website, and when it skips.
 *
 *   node scripts/vercel-ignore.test.mjs   (pnpm test:vercel-ignore)
 *
 * vercel.json's ignoreCommand decides: exit 0 skips the deployment, anything
 * else builds. A push that changes only the app skips; a website change
 * builds; and a redeploy of the commit already deployed builds, because that
 * is how a changed environment variable reaches the site. Without that last
 * rule a new SUPABASE_SERVICE_ROLE_KEY was cancelled twice while every
 * service-role call went on being refused with the old one.
 *
 * Vercel refuses a config whose ignoreCommand is longer than 256 characters,
 * and refuses it before any build log exists — the deployment just fails.
 *
 * The command runs here against a scratch repository, case by case.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { ignoreCommand } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
let failed = 0;
const is = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${actual}, expected ${expected}`}`);
};

is(`the command fits Vercel's 256 characters (${ignoreCommand.length})`, ignoreCommand.length <= 256, true);

const repo = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
const commit = (message, files = {}) => {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', message);
  return git('rev-parse', 'HEAD');
};
const builds = (previous) =>
  spawnSync('bash', ['-c', ignoreCommand], {
    cwd: repo,
    env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previous ?? '' },
  }).status !== 0;

try {
  git('init', '-q');
  const first = commit('first', { 'src/page.tsx': 'a' });
  is('a redeploy of the deployed commit builds', builds(first), true);
  const empty = commit('nothing');
  is('a commit that changes nothing skips', builds(first), false);
  const site = commit('site', { 'src/page.tsx': 'b' });
  is('a website change builds', builds(empty), true);
  commit('app', { 'mobile/app.tsx': 'x', '.github/workflows/mobile.yml': 'y' });
  is('a change only to the app skips', builds(site), false);
  is('a deployed commit missing from the clone builds', builds('0'.repeat(40)), true);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

const shots = spawnSync(process.execPath, [new URL('./look-shots-branch.test.mjs', import.meta.url).pathname], {
  stdio: 'inherit',
});
if ((shots.status ?? 1) !== 0) failed += 1;

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
