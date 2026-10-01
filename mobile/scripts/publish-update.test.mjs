/**
 * Over-the-air updates reach the builds they are meant for.
 *
 *   node --experimental-strip-types scripts/publish-update.test.mjs
 *
 * A build takes an update only when the update's runtime version — a
 * fingerprint of the configuration as evaluated — equals its own. This reads
 * the real eas.json and app.config.ts: the channels each profile listens on,
 * the environment scripts/publish-update.mjs publishes with, and that the
 * configuration evaluated in that environment is the one the store build was
 * made from, where a plain publish's is not.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileFor, updateArguments } from './publish-update.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eas = JSON.parse(readFileSync(join(appRoot, 'eas.json'), 'utf8'));

let pass = 0;
let fail = 0;
function is(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function throws(label, run, pattern) {
  try {
    run();
    is(label, 'no error', `an error matching ${pattern}`);
  } catch (error) {
    is(label, pattern.test(String(error.message)), true);
  }
}

console.log('— the channel and environment of each profile');
const production = profileFor(eas, 'production');
is('production publishes on the production channel', production.channel, 'production');
is('with the build profile named, as EAS names it in a build', production.env.EAS_BUILD_PROFILE, 'production');
for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SITE_URL']) {
  is(`and ${name} from the base profile`, production.env[name], eas.build.base.env[name]);
}
is('preview publishes on its own channel', profileFor(eas, 'preview').channel, 'preview');
throws('a development build takes no updates', () => profileFor(eas, 'development'), /development build/);
throws('nor does the simulator one, which extends it', () => profileFor(eas, 'development-simulator'), /development build/);
throws('an unknown profile is refused', () => profileFor(eas, 'prod'), /no build profile "prod"/);
throws('a profile without a channel is refused', () => profileFor({ build: { x: { env: {} } } }, 'x'), /no channel/);
throws(
  'a loop of extends is refused',
  () => profileFor({ build: { a: { extends: 'b', channel: 'a' }, b: { extends: 'a' } } }, 'a'),
  /extends itself/,
);
is(
  'a profile overrides one variable of its base and keeps the others',
  profileFor({ build: { base: { env: { A: '1', B: '2' } }, p: { extends: 'base', channel: 'c', env: { B: '3' } } } }, 'p').env,
  { A: '1', B: '3', EAS_BUILD_PROFILE: 'p' },
);

console.log('\n— the command');
is('iOS unless a platform is given', updateArguments('production', ['--message', 'x']), [
  'eas-cli@latest',
  'update',
  '--channel',
  'production',
  '--platform',
  'ios',
  '--message',
  'x',
]);
is('a platform given is kept', updateArguments('production', ['--platform', 'all']).slice(4), ['--platform', 'all']);
is('in either spelling', updateArguments('production', ['--platform=android']).slice(4), ['--platform=android']);

console.log('\n— the configuration a store build is made from');
/** app.config.ts evaluated with exactly these variables, as EAS or the publish script would. */
async function configWith(vars) {
  const saved = { ...process.env };
  for (const key of ['EAS_BUILD_PROFILE', 'EAS_PROJECT_ID', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SITE_URL']) {
    delete process.env[key];
  }
  Object.assign(process.env, vars);
  try {
    // A fresh copy each time: the project id and the site are read when the file loads.
    const { default: config } = await import(`${join(appRoot, 'app.config.ts')}?${Math.random()}`);
    return config({ config: {} });
  } finally {
    process.env = saved;
  }
}
const notificationsMode = (config) => config.plugins.find((plugin) => plugin[0] === 'expo-notifications')[1].mode;

// What EAS sets while building the production profile: the profile's name and eas.json's env.
const storeBuild = await configWith({ ...eas.build.base.env, EAS_BUILD_PROFILE: 'production' });
const published = await configWith(production.env);
const plainPublish = await configWith({});
is('the store build signs for production APNs', notificationsMode(storeBuild), 'production');
is('an update published by the script is configured as that build', JSON.stringify(published), JSON.stringify(storeBuild));
is('a plain `eas update` is not (development APNs), so its fingerprint would differ', notificationsMode(plainPublish), 'development');

console.log('\n— updates on and off');
is('without an EAS project, updates are off', storeBuild.updates, { enabled: false });
is('the runtime version is the fingerprint', storeBuild.runtimeVersion, { policy: 'fingerprint' });
const withProject = await configWith({ ...production.env, EAS_PROJECT_ID: '00000000-0000-4000-8000-000000000000' });
is('with one, they come from its EAS Update URL, checked at launch and run from the next', withProject.updates, {
  url: 'https://u.expo.dev/00000000-0000-4000-8000-000000000000',
  checkAutomatically: 'ON_LOAD',
  fallbackToCacheTimeout: 0,
});

console.log('\n— Face ID');
const purpose = (name) => storeBuild.plugins.find((plugin) => plugin[0] === name)?.[1]?.faceIDPermission;
is('the app lock has a purpose string', typeof purpose('expo-local-authentication'), 'string');
is('the secure store writes the same key with the same words', purpose('expo-secure-store'), purpose('expo-local-authentication'));
for (const locale of ['ar', 'en']) {
  const strings = JSON.parse(readFileSync(join(appRoot, 'assets', 'locales', `${locale}.json`), 'utf8')).ios;
  is(`and the ${locale} prompt is translated`, typeof strings.NSFaceIDUsageDescription, 'string');
}
is(
  'the Arabic prompt is the base string',
  JSON.parse(readFileSync(join(appRoot, 'assets', 'locales', 'ar.json'), 'utf8')).ios.NSFaceIDUsageDescription,
  purpose('expo-local-authentication'),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
