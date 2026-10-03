// Node's own modules, required as tests/server.ts does: the app's typings have no Node in them.
type Entry = { name: string; isDirectory: () => boolean };
/* eslint-disable @typescript-eslint/no-require-imports */
const { readdirSync, readFileSync } = require('node:fs') as {
  readdirSync: (dir: string, options: { withFileTypes: true }) => Entry[];
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const { join, relative, sep } = require('node:path') as {
  join: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
  sep: string;
};
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

/*
  Every place the app sends somebody names a screen that exists: each
  router.push / navigate / replace, routeInside, inOwnTab and openWhenReady
  with a written path, and each `pathname:` and `href:` in a link table (the
  setup checklist, the next action).

  Typed routes check most of these as the app compiles, but the employer's
  console is reached through casts (`as never`) the compiler cannot see
  through, and a typo there is a button that goes nowhere — found by whoever
  presses it.
*/

const SRC = join(__dirname, '..', 'src');
const APP = join(SRC, 'app');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The screens, as paths: route groups dropped, `index` the folder itself, `[x]` any one segment. */
const screens = files(APP)
  .map((file) => relative(APP, file).replace(/\.tsx?$/, '').split(sep))
  .filter((parts) => !parts.some((part) => part.startsWith('_') || part.startsWith('+')))
  .map((parts) => parts.filter((part) => !/^\(.*\)$/.test(part)))
  .map((parts) => (parts[parts.length - 1] === 'index' ? parts.slice(0, -1) : parts));

function screenFor(path: string): string[] | undefined {
  const segments = path.split(/[?#]/)[0].split('/').filter(Boolean);
  return screens.find(
    (screen) =>
      screen.length === segments.length &&
      screen.every((part, index) => part === segments[index] || /^\[.+\]$/.test(part)),
  );
}

const CALL = /(?:router\.(?:push|navigate|replace)|routeInside|inOwnTab|openWhenReady)\(\s*[`'"](\/[^`'"]*)[`'"]/g;
const FIELD = /(?:pathname|href):\s*[`'"](\/[^`'"]*)[`'"]/g;

const targets = files(SRC).flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(CALL), ...source.matchAll(FIELD)].map((match) => ({
    // A template's `${…}` stands for one segment.
    path: match[1].replace(/\$\{[^}]+\}/g, 'x'),
    file: relative(SRC, file),
  }));
});

describe('where the app sends people', () => {
  it('finds the links it checks', () => {
    // A pattern that stopped matching would pass everything below vacuously.
    expect(targets.length).toBeGreaterThan(30);
    expect(targets.some((target) => target.path === '/employer/company')).toBe(true);
  });

  it.each(targets.map((target) => [target.path, target.file]))('%s (%s) is a screen', (path) => {
    expect(screenFor(path)).toBeDefined();
  });

  it('would notice a path that is not one', () => {
    expect(screenFor('/employer/compnay')).toBeUndefined();
    expect(screenFor('/jobs/some-slug')).toBeDefined();
  });
});
