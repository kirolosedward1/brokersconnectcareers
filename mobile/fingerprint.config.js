/**
 * What the runtime version is a fingerprint of (app.config.ts, runtimeVersion:
 * fingerprint). An over-the-air update reaches only the builds whose
 * fingerprint it was published with, so anything counted here that is not the
 * native app makes a fix reach nobody, with nothing to say so.
 *
 * Expo counts package.json's scripts and .gitignore by default. Neither is
 * native in this app — ios/ and android/ are generated at build time and never
 * kept — and adding the licences check to `scripts` changed every fingerprint
 * while the native app stayed as it was. Both are left out.
 *
 * The config's `extra` section is left out too: it carries the commit a bundle
 * is published from (shown on Account), so counting it gave every commit its
 * own runtime version and an update published after a store build reached no
 * phone. Nothing in `extra` is native here (Expo Go's RTL flags, the EAS
 * project id, the commit); an over-the-air update carries its own copy.
 * scripts/publish-update.test.mjs checks what is counted.
 */
const { SourceSkips } = require('expo/fingerprint');

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: SourceSkips.PackageJsonScriptsAll | SourceSkips.GitIgnore | SourceSkips.ExpoConfigExtraSection,
};
