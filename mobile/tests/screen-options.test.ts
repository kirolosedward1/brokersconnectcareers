// Node's own modules, required as tests/server.ts does: the app's typings have no Node in them.
type Entry = { name: string; isDirectory: () => boolean };
/* eslint-disable @typescript-eslint/no-require-imports */
const { readdirSync, readFileSync } = require('node:fs') as {
  readdirSync: (dir: string, options: { withFileTypes: true }) => Entry[];
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const { join, relative } = require('node:path') as {
  join: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
};
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

/*
  A large title is asked for by its current name, headerLargeTitleEnabled.
  The old one, headerLargeTitle, still draws it, but expo-router's native
  stack debounces the header's height only under the new name: under the old
  one every step of the title collapsing as a list scrolls is a state update,
  and the whole screen is drawn again for each.
*/

const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const sources = files(SRC).map((file) => ({ file: relative(SRC, file), text: readFileSync(file, 'utf8') }));

describe('a large title', () => {
  it('is asked for under the name the native stack debounces', () => {
    expect(sources.filter(({ text }) => /\bheaderLargeTitle\s*:/.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it('is still asked for on the tabs that have one', () => {
    // Every tab's first screen but Home, whose title is the website's logo.
    expect(sources.filter(({ text }) => /\bheaderLargeTitleEnabled:\s*true/.test(text)).length).toBeGreaterThanOrEqual(8);
  });
});

describe("a tab's header", () => {
  it('is never handed the bell as an item that may draw nothing', () => {
    // An item that draws nothing still has its place: on iOS 26 an empty glass circle (useHeaderBell).
    expect(sources.filter(({ text }) => /headerRight:\s*\(\)\s*=>\s*<HeaderBell/.test(text)).map(({ file }) => file)).toEqual([]);
  });
});
