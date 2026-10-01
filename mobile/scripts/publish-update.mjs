#!/usr/bin/env node
/**
 * Publish an over-the-air update (EAS Update) that a store build will take.
 *
 *   pnpm run ota production --message "what changed"
 *   node scripts/publish-update.mjs <build profile> [eas update options…]
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

/** The `eas update` command line for a profile, with the options given after it. */
export function updateArguments(channel, options) {
  const platform = options.some((option) => option === '--platform' || option.startsWith('--platform=') || option === '-p');
  return ['eas-cli@latest', 'update', '--channel', channel, ...(platform ? [] : ['--platform', 'ios']), ...options];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [name, ...options] = process.argv.slice(2);
  if (!name || name.startsWith('-')) {
    console.error('Usage: pnpm run ota <build profile> --message "what changed"   (for example: production)');
    process.exit(1);
  }
  try {
    const { channel, env } = profileFor(JSON.parse(readFileSync(join(appRoot, 'eas.json'), 'utf8')), name);
    console.log(`Publishing to the "${channel}" channel, built as the "${name}" profile builds.`);
    const run = spawnSync('npx', updateArguments(channel, options), {
      cwd: appRoot,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    process.exit(run.status ?? 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
