/**
 * The look-shots branch has to carry its own vercel.json.
 *
 * Vercel reads that file from the branch it is deploying. look-shots is an
 * orphan branch the look job writes, so the flag on main never reaches it and
 * the deployment fails. post-look-shots.sh commits git.deploymentEnabled false
 * at the root of every push, including one onto a branch that does not have
 * the file yet.
 *
 *   node scripts/look-shots-branch.test.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../mobile/scripts/post-look-shots.sh', import.meta.url).pathname;
const realGit = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

let failed = 0;
const is = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

const root = mkdtempSync(join(tmpdir(), 'look-shots-'));
const git = (cwd, ...args) => execFileSync(realGit, args, { cwd, stdio: 'pipe' });

function bare(name) {
  const path = join(root, name);
  execFileSync(realGit, ['init', '--bare', '-q', path]);
  return path;
}

function seedShots(remote) {
  const seed = join(root, `seed-${remote.split('/').pop()}`);
  git(root, 'init', '-q', '-b', 'look-shots', seed);
  mkdirSync(join(seed, 'earlier'));
  writeFileSync(join(seed, 'earlier', 'kept.png'), 'old');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'earlier shots');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-q', 'origin', 'HEAD:look-shots');
}

function shotsDir(name) {
  const path = join(root, name);
  mkdirSync(path);
  writeFileSync(join(path, 'screen.png'), 'png');
  return path;
}

function pushShots(remote, run, shots, extraEnv = {}) {
  return spawnSync('bash', [script, shots], {
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REPOSITORY: 'acme/widgets',
      GITHUB_RUN_ID: run,
      PR_NUMBER: '1',
      LOOK_SHOTS_REMOTE: remote,
      LOOK_SHOTS_SKIP_COMMENT: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

function show(remote, spec) {
  const result = spawnSync(realGit, ['--git-dir', remote, 'show', `look-shots:${spec}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

try {
  const remote = bare('plain.git');
  seedShots(remote);
  const first = pushShots(remote, '101', shotsDir('one'));
  is('a branch that had no vercel.json accepts the push', first.status, 0);
  is(
    'the push commits deploymentEnabled false',
    JSON.parse(show(remote, 'vercel.json')),
    { git: { deploymentEnabled: false } },
  );
  is('the earlier shot is still on the branch', show(remote, 'earlier/kept.png'), 'old');
  is('this run’s shot is on the branch', show(remote, '101/screen.png'), 'png');

  const second = pushShots(remote, '102', shotsDir('two'));
  is('a later run pushes too', second.status, 0);
  is(
    'the later run leaves deploymentEnabled false',
    JSON.parse(show(remote, 'vercel.json')),
    { git: { deploymentEnabled: false } },
  );
  is('both runs stay on the branch', show(remote, '102/screen.png'), 'png');

  // The first push of a raced pair is refused after somebody else has already
  // added the same vercel.json. The retry rebases and still skips deploys.
  const raced = bare('raced.git');
  seedShots(raced);
  const flag = join(root, 'raced-once');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const wrapper = join(bin, 'git');
  writeFileSync(
    wrapper,
    `#!/bin/bash
set -euo pipefail
if [ "$1" = "-C" ] && [ "$3" = "push" ] && [ ! -f "$RACE_FLAG" ]; then
  touch "$RACE_FLAG"
  side=$(mktemp -d)
  "$REAL_GIT" clone -q -b look-shots "$RACE_REMOTE" "$side"
  mkdir -p "$side/999"
  printf 'other' > "$side/999/other.png"
  cat > "$side/vercel.json" <<'EOF'
{
  "git": {
    "deploymentEnabled": false
  }
}
EOF
  "$REAL_GIT" -C "$side" -c user.name=t -c user.email=t@t add -A
  "$REAL_GIT" -C "$side" -c user.name=t -c user.email=t@t commit -qm other
  "$REAL_GIT" -C "$side" push -q origin HEAD:look-shots
  exit 1
fi
exec "$REAL_GIT" "$@"
`,
  );
  chmodSync(wrapper, 0o755);
  const race = pushShots(raced, '303', shotsDir('three'), {
    PATH: `${bin}:${process.env.PATH}`,
    REAL_GIT: realGit,
    RACE_FLAG: flag,
    RACE_REMOTE: raced,
  });
  is('a raced push still lands', race.status, 0);
  if (race.status !== 0) console.log(race.stderr);
  is(
    'the raced branch still skips deployments',
    JSON.parse(show(raced, 'vercel.json')),
    { git: { deploymentEnabled: false } },
  );
  is('the raced run’s shot landed', show(raced, '303/screen.png'), 'png');
  is('the other run’s shot landed', show(raced, '999/other.png'), 'other');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
