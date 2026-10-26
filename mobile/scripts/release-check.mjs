#!/usr/bin/env node
/**
 * What a store build is made from, checked before one is paid for.
 *
 *   pnpm release:check                 the configuration the production profile builds
 *   pnpm release:check --bundle dist   and a bundle exported from it (pnpm export:ios)
 *
 * It reads eas.json, app.config.ts evaluated as EAS evaluates it for the
 * `production` profile, store.config.js and the image files, and needs no
 * account, network or Mac. Each line is a fact a store build depends on; any
 * one false fails the run. docs/release/2026-10-store-readiness.md says what
 * it covers and what only the owner can do.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { profileFor } from './publish-update.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(appRoot, 'package.json'));

const BUNDLE_ID = 'net.brokersconnect.app';
const SUPABASE = 'https://hiwdhicwsohbipxzazmb.supabase.co';
const SITE = 'https://www.brokersconnect.net';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n    ${detail}` : ''}`);
}
const section = (title) => console.log(`\n— ${title}`);

/** Width, height and PNG colour type (2 = RGB, 6 = RGBA) from the IHDR chunk. */
function png(path) {
  const bytes = readFileSync(join(appRoot, path));
  if (bytes.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

/** A JWT's payload role, or null for anything that is not one. */
function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
section('the production build profile (eas.json)');
const eas = JSON.parse(readFileSync(join(appRoot, 'eas.json'), 'utf8'));
const chain = [];
for (let at = 'production'; at !== undefined; at = eas.build[at]?.extends) chain.unshift(eas.build[at]);
const production = Object.assign({}, ...chain);
const { env } = profileFor(eas, 'production');

check('builds for the store, not a development client', !production.developmentClient && production.distribution !== 'internal');
check('builds for a device, not the simulator', !production.ios?.simulator);
check('listens for updates on the production channel', production.channel === 'production');
check('takes its build number from EAS, one higher each build', eas.cli?.appVersionSource === 'remote' && production.autoIncrement === true);
check(
  'carries only the three public EXPO_PUBLIC_ values, the ones the bundle may hold',
  JSON.stringify(Object.keys(env).filter((key) => key.startsWith('EXPO_PUBLIC_')).sort()) ===
    JSON.stringify(['EXPO_PUBLIC_SITE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_URL']),
);
check('talks to the production Supabase project', env.EXPO_PUBLIC_SUPABASE_URL === SUPABASE, env.EXPO_PUBLIC_SUPABASE_URL);
check(
  "with the publishable key, never a secret or service-role one",
  /^sb_publishable_[A-Za-z0-9_-]+$/.test(env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '') && jwtRole(env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '') === null,
);
check('and the production website, over HTTPS', env.EXPO_PUBLIC_SITE_URL === SITE, env.EXPO_PUBLIC_SITE_URL);
check(
  'a submit to App Store Connect fills the listing from store.config.js',
  eas.submit?.production?.ios?.metadataPath === './store.config.js',
);
check(
  'a submit to Google Play goes to internal testing as a draft, never straight to the public',
  eas.submit?.production?.android?.track === 'internal' && eas.submit?.production?.android?.releaseStatus === 'draft',
);

// ---------------------------------------------------------------------------
section('the app as the production profile evaluates it (app.config.ts)');
const saved = { ...process.env };
for (const key of ['EAS_PROJECT_ID', 'EXPO_GO_UPDATE', 'GOOGLE_SERVICES_JSON']) delete process.env[key];
Object.assign(process.env, env);
const { default: configure } = await import(join(appRoot, 'app.config.ts'));
const config = configure({ config: {} });
process.env = saved;

const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
const listing = require('./store.config.js').storeConfig({});
check('version is x.y.z', /^\d+\.\d+\.\d+$/.test(config.version), config.version);
check(
  'and the same in package.json and the App Store listing',
  config.version === pkg.version && config.version === listing.apple.version,
  `app ${config.version}, package.json ${pkg.version}, listing ${listing.apple.version}`,
);
check(`iOS bundle id and Android package are both ${BUNDLE_ID}`, config.ios.bundleIdentifier === BUNDLE_ID && config.android.package === BUNDLE_ID);
check('no build number written in the file (EAS owns it)', config.ios.buildNumber === undefined && config.android.versionCode === undefined);
const notifications = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications');
check('pushes sign for the production APNs environment', notifications?.[1]?.mode === 'production');
check(
  'updates come from the EAS project, matched by fingerprint',
  config.updates?.url === `https://u.expo.dev/${config.extra?.eas?.projectId}` && config.runtimeVersion?.policy === 'fingerprint',
);
check('a store build never waits at launch for an update', config.updates?.fallbackToCacheTimeout === 0);
check('declares no non-exempt encryption (export compliance)', config.ios.config?.usesNonExemptEncryption === false);
check('its privacy manifest says it does not track', config.ios.privacyManifests?.NSPrivacyTracking === false);
check(
  'every collected data type is linked, not tracking, for app functionality only',
  (config.ios.privacyManifests?.NSPrivacyCollectedDataTypes ?? []).every(
    (type) =>
      type.NSPrivacyCollectedDataTypeLinked === true &&
      type.NSPrivacyCollectedDataTypeTracking === false &&
      JSON.stringify(type.NSPrivacyCollectedDataTypePurposes) === '["NSPrivacyCollectedDataTypePurposeAppFunctionality"]',
  ),
);
const host = new URL(SITE).host;
check(
  'universal links and password AutoFill name the production website',
  JSON.stringify(config.ios.associatedDomains) === JSON.stringify([`applinks:${host}`, `webcredentials:${host}`]),
);
check(
  'Android App Links name the production website',
  config.android.intentFilters.every((filter) => filter.data.every((data) => data.scheme === 'https' && data.host === host)),
);
check(
  'Android drops the permission to draw over other apps',
  config.android.blockedPermissions?.includes('android.permission.SYSTEM_ALERT_WINDOW'),
);
const picker = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-image-picker')?.[1] ?? {};
check(
  'every permission the app asks for has its purpose in words, and the microphone is not asked for',
  Boolean(picker.photosPermission && picker.cameraPermission) && picker.microphonePermission === false,
);

// ---------------------------------------------------------------------------
section('the Google Play listing (store/play/listing.js)');
const { listing: play, LIMITS } = require('./store/play/listing.js');
for (const [locale, fields] of Object.entries(play.locales)) {
  const over = Object.entries(LIMITS).filter(([field, limit]) => !fields[field] || [...fields[field]].length > limit);
  check(`${locale}: title, short and full description are given and within Play's limits`, over.length === 0, over.map(([field]) => field).join(', '));
}
const business = readFileSync(join(appRoot, '..', 'src', 'lib', 'business.ts'), 'utf8');
check("the contact email is the operator's (src/lib/business.ts)", business.includes(`email: '${play.contactEmail}'`));
check(
  'the privacy policy and account-deletion pages are the App Store listing’s',
  play.privacyPolicyUrl === `${SITE}/privacy` && play.accountDeletionUrl === `${SITE}/account-deletion`,
);

// ---------------------------------------------------------------------------
section('icons and launch screen');
const icon = png(config.icon.replace(/^\.\//, ''));
check('the App Store icon is 1024 × 1024 and opaque', icon?.width === 1024 && icon?.height === 1024 && icon?.colourType === 2, JSON.stringify(icon));
for (const [label, path] of [
  ['the Android adaptive icon', config.android.adaptiveIcon.foregroundImage],
  ['its monochrome layer', config.android.adaptiveIcon.monochromeImage],
]) {
  const image = png(path.replace(/^\.\//, ''));
  check(`${label} is 1024 × 1024`, image?.width === 1024 && image?.height === 1024, JSON.stringify(image));
}
const splash = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')?.[1];
check('the launch screen has its image and a background colour', Boolean(splash && png(splash.image.replace(/^\.\//, '')) && /^#[0-9A-F]{6}$/i.test(splash.backgroundColor)));
const playIcon = existsSync(join(appRoot, 'store/play/icon-512.png')) ? png('store/play/icon-512.png') : null;
const feature = existsSync(join(appRoot, 'store/play/feature-graphic.png')) ? png('store/play/feature-graphic.png') : null;
check('the Google Play icon is 512 × 512 (scripts/play-graphics.py)', playIcon?.width === 512 && playIcon?.height === 512);
check('the Google Play feature graphic is 1024 × 500 and opaque', feature?.width === 1024 && feature?.height === 500 && feature?.colourType === 2);

// ---------------------------------------------------------------------------
const bundleAt = process.argv.indexOf('--bundle');
if (bundleAt !== -1) {
  const dir = resolve(process.argv[bundleAt + 1] ?? 'dist');
  section(`the exported bundle (${dir})`);
  const files = [];
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(hbc|js|json|map)$/.test(name)) files.push(path);
    }
  };
  walk(dir);
  const bundles = files.filter((file) => /\.(hbc|js)$/.test(file));
  check('holds a JavaScript bundle', bundles.length > 0);
  const text = files.map((file) => readFileSync(file).toString('latin1')).join('\n');
  check('has the production Supabase address and website built in', text.includes(SUPABASE) && text.includes(SITE));
  // A real secret key is sb_secret_ and then its value; the bare prefix is
  // the website's own check for one (src/lib/security), followed by a name.
  const secretKeys = text.match(/sb_secret_[A-Za-z0-9-]{20,}/g) ?? [];
  check('holds no Supabase secret key', secretKeys.length === 0, secretKeys.join(', '));
  const serviceTokens = (text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []).filter(
    (token) => jwtRole(token) === 'service_role',
  );
  check('holds no service-role token', serviceTokens.length === 0);
  check('holds no private key', !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text));
  check('was built with no demo password', !/NEXT_PUBLIC_DEMO_PASSWORD|DEMO_PASSWORD=/.test(text));
}

console.log(failures === 0 ? '\nReady to build.' : `\n${failures} check${failures === 1 ? '' : 's'} failed.`);
process.exit(failures === 0 ? 0 : 1);
