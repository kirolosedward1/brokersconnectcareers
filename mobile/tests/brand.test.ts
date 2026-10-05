// Node's own modules, required as tests/server.ts does: the app's typings have no Node in them.
/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync } = require('node:fs') as { readFileSync: (path: string) => { equals: (other: unknown) => boolean } };
const { join } = require('node:path') as { join: (...parts: string[]) => string };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

/*
  The app's logo is the website's: the mark the site's header draws
  (src/components/logo.tsx), copied into the app because Metro bundles only
  what is under mobile/ and the folders it is told to watch. A new mark on
  the website fails this until the app has it too.
*/
it("is the website's own mark, byte for byte", () => {
  const app = readFileSync(join(__dirname, '..', 'assets', 'brand', 'logo-mark.png'));
  const site = readFileSync(join(__dirname, '..', '..', 'public', 'brand', 'logo-mark.png'));
  expect(app.equals(site)).toBe(true);
});
