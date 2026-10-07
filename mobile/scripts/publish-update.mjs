#!/usr/bin/env node
/**
 * Publish an over-the-air update (EAS Update) that a store build will take.
 *
 *   pnpm run ota production --message "what changed"
 *   node scripts/publish-update.mjs <build profile> [eas update options…]
 *   pnpm run ota expo-go --message "what changed"     (for Expo Go, below)
 *
 * A build takes only updates made for its own native code: the runtime
 * version is a fingerprint of app.config.ts as evaluated, and of the native
 * modules (app.config.ts, `updates`). The configuration depends on the
 * environment it is read in — the APNs mode follows EAS_BUILD_PROFILE, the
 * website's host follows EXPO_PUBLIC_SITE_URL — and EAS sets those from
 * eas.json during a build, but not when an update is published. A plain
 * `eas update` therefore computes another fingerprint, and the update reaches
 * nobody. Worse, the bundle takes the Supabase address and key at build time
 * (src/lib/env.ts): published from a shell without them, or with a staging
 * project's in a .env file, it would stop every phone that took it at launch,
 * or point them all at the wrong database.
 *
 * So this runs `eas update` with the build profile's own environment, read
 * from eas.json, on that profile's channel. Variables already set in the shell
 * are overridden for these names, and Expo does not let a .env file replace a
 * variable that is already set: eas.json is the one source, as for builds.
 *
 * iOS only unless `--platform` is given: an Android build's fingerprint also
 * covers its google-services.json (GOOGLE_SERVICES_JSON), which an update must
 * then be published with too.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A build profile as EAS resolves it — each `extends` beneath, the profile's
 * own keys on top, `env` merged key by key — reduced to what an update needs:
 * its channel and the environment the build was made in.
 */
export function profileFor(eas, name) {
  const profiles = eas?.build ?? {};
  const chain = [];
  const seen = new Set();
  for (let at = name; at !== undefined; at = profiles[at].extends) {
    if (!Object.hasOwn(profiles, at)) throw new Error(`eas.json has no build profile "${at}"`);
    if (seen.has(at)) throw new Error(`eas.json: build profile "${at}" extends itself`);
    seen.add(at);
    chain.unshift(profiles[at]);
  }

  const settings = Object.assign({}, ...chain);
  if (settings.developmentClient) {
    throw new Error(`"${name}" is a development build: it runs code from your computer, not published updates`);
  }
  if (!settings.channel) throw new Error(`eas.json: build profile "${name}" has no channel`);

  const env = Object.assign({}, ...chain.map((profile) => profile.env ?? {}));
  return { channel: settings.channel, env: { ...env, EAS_BUILD_PROFILE: name } };
}

/**
 * Expo Go, the App Store app: an update it opens with no computer running,
 * from a link or a QR code, on the `expo-go` channel. It runs on Expo Go's
 * native code, so its runtime version is Expo Go's SDK (EXPO_GO_UPDATE in
 * app.config.ts), and the bundle carries the store build's settings: the
 * production profile's environment, so the phone talks to production.
 */
export const EXPO_GO = 'expo-go';

export function expoGoTarget(eas) {
  const { env } = profileFor(eas, 'production');
  return { channel: EXPO_GO, env: { ...env, EXPO_GO_UPDATE: '1' } };
}

/** The EAS project's id: EAS_PROJECT_ID, or the constant app.config.ts carries. */
export function projectIdFrom(env, appConfigSource) {
  if (env.EAS_PROJECT_ID) return env.EAS_PROJECT_ID;
  const written = /const EAS_PROJECT_ID: string \| null = '([^']+)';/.exec(appConfigSource);
  return written ? written[1] : null;
}

/** The app's name and slug as app.config.ts writes them: what its EAS project is called. */
export function appIdentityFrom(appConfigSource) {
  const name = /^ {2}name: '([^']+)',$/m.exec(appConfigSource)?.[1];
  const slug = /^ {2}slug: '([^']+)',$/m.exec(appConfigSource)?.[1];
  if (!name || !slug) throw new Error('app.config.ts: no name or slug found');
  return { name, slug };
}

/**
 * The Expo account a token or a login acts as: the first line `eas whoami`
 * prints, "<name> (authenticated using EXPO_TOKEN)" for a token. A robot's
 * token is refused: a robot has no account of its own, and Expo Go on the
 * phone is signed in to a person's.
 */
export function accountFromWhoami(output) {
  const first = output.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const name = first.replace(/ \(authenticated using EXPO_TOKEN\)$/, '');
  if (!name) throw new Error('`eas whoami` named no account');
  if (/\(robot\)$/.test(name) || name === 'robot') {
    throw new Error("A robot's token has no account of its own: use a personal access token (expo.dev → Account settings → Access tokens)");
  }
  return name;
}

/** What `eas init --json` answers: the project it created or found, and whose it is. */
export function linkedProject(stdout) {
  const answer = JSON.parse(stdout);
  if (typeof answer.projectId !== 'string' || !answer.projectId) throw new Error('`eas init` answered without a project id');
  return { projectId: answer.projectId, owner: answer.owner, slug: answer.slug, status: answer.status };
}

/** eas-cli, as the rest of this script runs it, answering in text. */
function runEas(args, options) {
  return spawnSync('npx', ['--yes', 'eas-cli@latest', ...args], { encoding: 'utf8', ...options });
}

/**
 * The app's EAS project on the account the token (or login) belongs to,
 * created the first time and found every time after: `eas init`, Expo's own
 * way, run in a scratch directory that holds only the app's name and slug.
 * In the app's own directory it would create the project and then stop,
 * unable to write the id into app.config.ts. So Expo Go needs nothing set up on
 * expo.dev beyond the token; builds and pushes still need the id written in
 * app.config.ts (EAS_PROJECT_ID), which the publish prints.
 */
export function findOrCreateProject({ name, slug }, eas = runEas) {
  const who = eas(['whoami'], { cwd: appRoot, env: process.env });
  if (who.status !== 0) {
    throw new Error('Not signed in to Expo: set EXPO_TOKEN (an access token from expo.dev), or run `npx eas-cli@latest login`');
  }
  const account = accountFromWhoami(who.stdout);
  const scratch = mkdtempSync(join(tmpdir(), 'eas-project-'));
  try {
    writeFileSync(join(scratch, 'package.json'), `${JSON.stringify({ name: 'eas-project-link', private: true })}\n`);
    writeFileSync(join(scratch, 'app.json'), `${JSON.stringify({ expo: { name, slug } })}\n`);
    const init = eas(['init', '--non-interactive', '--account', account, '--json', '--no-icon'], {
      cwd: scratch,
      env: { ...process.env, EAS_NO_VCS: '1', EAS_PROJECT_ROOT: scratch },
    });
    if (init.status !== 0) {
      throw new Error(`\`eas init\` could not find or create @${account}/${slug}:\n${(init.stderr ?? '').trim().split('\n').slice(-6).join('\n')}`);
    }
    return linkedProject(init.stdout);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Expo's page with the QR code that opens the channel's newest update in Expo Go (`slug=exp`). */
export function expoGoLink(projectId, sdkVersion) {
  const query = new URLSearchParams({ slug: 'exp', projectId, runtimeVersion: `exposdk:${sdkVersion}`, channel: EXPO_GO });
  return `https://qr.expo.dev/eas-update?${query}`;
}

/** The `eas update` command line for a profile, with the options given after it. */
export function updateArguments(channel, options) {
  const platform = options.some((option) => option === '--platform' || option.startsWith('--platform=') || option === '-p');
  return ['eas-cli@latest', 'update', '--channel', channel, ...(platform ? [] : ['--platform', 'ios']), ...options];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [name, ...options] = process.argv.slice(2);
  if (!name || name.startsWith('-')) {
    console.error('Usage: pnpm run ota <build profile | expo-go> --message "what changed"   (for example: production)');
    process.exit(1);
  }
  try {
    const eas = JSON.parse(readFileSync(join(appRoot, 'eas.json'), 'utf8'));
    let target;
    let link = null;
    if (name === EXPO_GO) {
      const source = readFileSync(join(appRoot, 'app.config.ts'), 'utf8');
      let projectId = projectIdFrom(process.env, source);
      if (!projectId) {
        // Nothing written yet: the token's own account has (or now gets) the project.
        const project = findOrCreateProject(appIdentityFrom(source));
        projectId = project.projectId;
        console.log(
          `EAS project @${project.owner}/${project.slug} (${project.status}). EAS project id: ${projectId}\n` +
            'Builds and pushes need it written in app.config.ts in place of null (EAS_PROJECT_ID).',
        );
      }
      const sdkMajor = JSON.parse(readFileSync(join(appRoot, 'node_modules/expo/package.json'), 'utf8')).version.split('.')[0];
      target = expoGoTarget(eas);
      // app.config.ts takes the id from here when it carries none itself.
      target.env.EAS_PROJECT_ID = projectId;
      link = expoGoLink(projectId, `${sdkMajor}.0.0`);
      console.log(`Publishing for Expo Go (SDK ${sdkMajor}) to the "${target.channel}" channel, with the store build's settings.`);
    } else {
      target = profileFor(eas, name);
      console.log(`Publishing to the "${target.channel}" channel, built as the "${name}" profile builds.`);
    }
    const run = spawnSync('npx', updateArguments(target.channel, options), {
      cwd: appRoot,
      stdio: 'inherit',
      env: { ...process.env, ...target.env },
    });
    if (run.status === 0 && link) {
      console.log(`\nOpen it in Expo Go: scan the QR code on ${link}\nwith the iPhone's camera (signed in to the same Expo account in Expo Go).`);
    }
    process.exit(run.status ?? 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
