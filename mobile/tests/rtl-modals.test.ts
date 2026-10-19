// Node's own modules, required as tests/route-targets.test.ts does: the app's typings have no Node in them.
type Entry = { name: string; isDirectory: () => boolean };
/* eslint-disable @typescript-eslint/no-require-imports */
const { readdirSync, readFileSync } = require('node:fs') as {
  readdirSync: (dir: string, options: { withFileTypes: true }) => Entry[];
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

/**
 * A Modal is presented on a root of its own: it does not take the direction
 * the app's root view lays everything out in (lib/direction.ts), and in Expo
 * Go, where the manifest's forcesRTL is not applied, its rows, chevrons and
 * text came out left to right. Every sheet sets it on its outermost view.
 */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx$/.test(entry.name) ? [path] : [];
  });
}

describe('sheets read in the app direction', () => {
  const sheets = files(join(__dirname, '../src')).filter((path) => readFileSync(path, 'utf8').includes('<Modal'));

  it('finds the sheets', () => {
    expect(sheets.length).toBeGreaterThan(5);
  });

  it.each(sheets.map((path) => [path.split('/src/')[1], path]))('%s lays its content out in appDirection', (_name, path) => {
    expect(readFileSync(path, 'utf8')).toMatch(/direction: appDirection/);
  });
});
