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
import { readFileSync } from 'node:fs';
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
      const projectId = projectIdFrom(process.env, readFileSync(join(appRoot, 'app.config.ts'), 'utf8'));
      if (!projectId) {
        throw new Error(
          'No EAS project yet: run `npx eas-cli@latest init` (or create the project on expo.dev) and put its id in ' +
            'app.config.ts in place of null (EAS_PROJECT_ID).',
        );
      }
      const sdkMajor = JSON.parse(readFileSync(join(appRoot, 'node_modules/expo/package.json'), 'utf8')).version.split('.')[0];
      target = expoGoTarget(eas);
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
