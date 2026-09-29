// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
  {
    // Named rather than detected: eslint-plugin-react's detection calls an
    // API ESLint 10 no longer has.
    settings: { react: { version: '19.2' } },
  },
  {
    // Tooling that runs in Node, not on the phone.
    files: ['*.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The tests run under Jest, whose globals ESLint should know.
    files: ['tests/**/*'],
    languageOptions: { globals: globals.jest },
  },
]);
