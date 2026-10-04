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
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountFromWhoami,
  appIdentityFrom,
  expoGoLink,
  expoGoTarget,
  findOrCreateProject,
  linkedProject,
  profileFor,
  projectIdFrom,
  updateArguments,
} from './publish-update.mjs';

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
  for (const key of ['EAS_BUILD_PROFILE', 'EAS_PROJECT_ID', 'EXPO_GO_UPDATE', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SITE_URL']) {
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
is('the store build fetches updates from the EAS project app.config.ts names', storeBuild.updates, {
  url: 'https://u.expo.dev/5598b160-d5fd-42e3-9cfd-14097b6677e9',
  checkAutomatically: 'ON_LOAD',
  fallbackToCacheTimeout: 0,
});
is("and is that project's, under its slug and owner", [storeBuild.slug, storeBuild.owner, storeBuild.extra.eas.projectId], [
  'brokers-connect-careers',
  'kirolosedward1',
  '5598b160-d5fd-42e3-9cfd-14097b6677e9',
]);
is('the runtime version is the fingerprint', storeBuild.runtimeVersion, { policy: 'fingerprint' });
const withProject = await configWith({ ...production.env, EAS_PROJECT_ID: '00000000-0000-4000-8000-000000000000' });
is('with one, they come from its EAS Update URL, checked at launch and run from the next', withProject.updates, {
  url: 'https://u.expo.dev/00000000-0000-4000-8000-000000000000',
  checkAutomatically: 'ON_LOAD',
  fallbackToCacheTimeout: 0,
});

console.log('\n— an update Expo Go opens, with no computer running');
{
  const go = expoGoTarget(eas);
  is('Expo Go publishes on its own channel', go.channel, 'expo-go');
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SITE_URL']) {
    is(`with the store build's ${name}`, go.env[name], eas.build.base.env[name]);
  }
  is('and the switch app.config.ts reads', go.env.EXPO_GO_UPDATE, '1');

  const goConfig = await configWith({ ...go.env, EAS_PROJECT_ID: '00000000-0000-4000-8000-000000000000' });
  is("its runtime version is Expo Go's SDK, which Expo resolves to exposdk:<SDK>", goConfig.runtimeVersion, { policy: 'sdkVersion' });
  is('right to left still forced, as Expo Go reads it', goConfig.extra.forcesRTL, true);
  is('fetched from the project, like a build', goConfig.updates.url, 'https://u.expo.dev/00000000-0000-4000-8000-000000000000');
  is('and nothing else differs from the store build', JSON.stringify({ ...goConfig, runtimeVersion: null, updates: null }),
    JSON.stringify({ ...(await configWith({ ...production.env, EAS_PROJECT_ID: '00000000-0000-4000-8000-000000000000' })), runtimeVersion: null, updates: null }));

  is('the project id from the environment first', projectIdFrom({ EAS_PROJECT_ID: 'from-env' }, "const EAS_PROJECT_ID: string | null = 'in-file';"), 'from-env');
  is('then the one app.config.ts carries', projectIdFrom({}, "const EAS_PROJECT_ID: string | null = 'in-file';"), 'in-file');
  is('which is the project made on expo.dev', projectIdFrom({}, readFileSync(join(appRoot, 'app.config.ts'), 'utf8')), '5598b160-d5fd-42e3-9cfd-14097b6677e9');
  is("none while it is null: the publish then finds or creates the project on the token's account", projectIdFrom({}, 'const EAS_PROJECT_ID: string | null = null;'), null);
  is(
    "Expo's QR page opens the channel's newest update in Expo Go",
    expoGoLink('p-1', '57.0.0'),
    'https://qr.expo.dev/eas-update?slug=exp&projectId=p-1&runtimeVersion=exposdk%3A57.0.0&channel=expo-go',
  );
}

console.log('\n— the EAS project for Expo Go, found or created from the token alone');
{
  // eas-cli 24.10.0's own words, from a rehearsal against a stand-in for
  // api.expo.dev (EXPO_LOCAL=1): `eas whoami` with a token, then `eas init`
  // creating the project, and on the next run finding it.
  const whoami = 'owner (authenticated using EXPO_TOKEN)\nowner@example.com\n';
  const created = JSON.stringify({ status: 'created', projectId: '11111111-2222-4333-8444-000000000001', owner: 'owner', slug: 'brokers-connect-careers' });

  is('the app is named as app.config.ts names it', appIdentityFrom(readFileSync(join(appRoot, 'app.config.ts'), 'utf8')), {
    name: 'Brokers Connect',
    slug: 'brokers-connect-careers',
  });
  is("the token's account, from `eas whoami`", accountFromWhoami(whoami), 'owner');
  is(
    'a login with teams is still its own person',
    accountFromWhoami('someone\nsomeone@example.com\n\nAccounts:\n• someone (Role: Owner)\n• agency (Role: Admin)\n'),
    'someone',
  );
  throws("a robot's token is refused: it has no account of its own", () => accountFromWhoami('ci (robot) (authenticated using EXPO_TOKEN)\n'), /personal access token/);
  is('the project `eas init --json` answers with', linkedProject(created).projectId, '11111111-2222-4333-8444-000000000001');
  throws('an answer without an id is refused', () => linkedProject('{"status":"created"}'), /without a project id/);

  const calls = [];
  const fake = (answers) => (args, options) => {
    const files = args[0] === 'init' ? JSON.parse(readFileSync(join(options.cwd, 'app.json'), 'utf8')) : null;
    calls.push({ args, cwd: options.cwd, files, vcs: options.env.EAS_NO_VCS });
    return answers[args[0]];
  };
  const project = findOrCreateProject(
    { name: 'Brokers Connect', slug: 'brokers-connect-careers' },
    fake({ whoami: { status: 0, stdout: whoami, stderr: '' }, init: { status: 0, stdout: created, stderr: '' } }),
  );
  is('it asks who the token is, then has `eas init` find or create the project', calls.map((call) => call.args[0]), ['whoami', 'init']);
  is('on that account, without asking, answering in JSON', calls[1].args, ['init', '--non-interactive', '--account', 'owner', '--json', '--no-icon']);
  is('in a scratch directory holding only the name and slug', calls[1].files, { expo: { name: 'Brokers Connect', slug: 'brokers-connect-careers' } });
  is('outside any repository', calls[1].vcs, '1');
  is('which is gone afterwards', existsSync(calls[1].cwd), false);
  is('and the id comes back', project, { projectId: '11111111-2222-4333-8444-000000000001', owner: 'owner', slug: 'brokers-connect-careers', status: 'created' });

  throws(
    'without a token or a login it says what is missing',
    () => findOrCreateProject({ name: 'n', slug: 's' }, fake({ whoami: { status: 1, stdout: '', stderr: 'Not logged in' } })),
    /set EXPO_TOKEN/,
  );
  throws(
    'and when Expo refuses, it says why',
    () =>
      findOrCreateProject(
        { name: 'n', slug: 's' },
        fake({ whoami: { status: 0, stdout: whoami, stderr: '' }, init: { status: 1, stdout: '', stderr: 'Error: GraphQL request failed.\nForbidden' } }),
      ),
    /@owner\/s:\n[\s\S]*Forbidden/,
  );
}

console.log('\n— what the runtime version is a fingerprint of');
{
  // As expo-updates takes it for this app (ios/ and android/ are generated),
  // in the store build's environment: the native app, and nothing a fix
  // published over the air could not have changed. fingerprint.config.js.
  const { createFingerprintAsync } = createRequire(join(appRoot, 'package.json'))('expo/fingerprint');
  const saved = process.env;
  process.env = { ...saved, ...eas.build.base.env, EAS_BUILD_PROFILE: 'production' };
  try {
    const fingerprint = await createFingerprintAsync(appRoot, {
      platforms: ['ios'],
      ignorePaths: ['android/**/*', 'ios/**/*'],
      silent: true,
    });
    const counted = fingerprint.sources.map((source) => source.id ?? source.filePath);
    is('package.json scripts are not counted (a new check script changed every fingerprint)', counted.includes('packageJson:scripts'), false);
    is('nor .gitignore', counted.includes('.gitignore'), false);
    is(
      'the configuration and the native modules are',
      ['expoConfig', 'expoAutolinkingConfig:ios', 'rncoreAutolinkingConfig:ios'].every((id) => counted.includes(id)),
      true,
    );
  } finally {
    process.env = saved;
  }
}

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
