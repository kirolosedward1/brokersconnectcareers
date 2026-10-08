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
  No screen asks for iOS's large title. On iOS 26 one under a painted bar is
  not drawn until the screen is scrolled: the tabs opened on an empty band
  over their search field (the owner's iPhone). On a clear bar it is drawn
  mirrored at the left edge wherever iOS itself runs left to right — in Expo
  Go, and on any iPhone not set to Arabic — under the bar the app turns right
  to left: the Expo Go check read «الوظائف» as «فألكهاا». The bar's own title,
  centred, is drawn right from the first frame, in either.
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
  it('is asked for by no screen, under either name', () => {
    expect(sources.filter(({ text }) => /\bheaderLargeTitle(Enabled)?\s*:\s*true/.test(text)).map(({ file }) => file)).toEqual([]);
  });
});

describe("a tab's header", () => {
  it('is never handed the bell as an item that may draw nothing', () => {
    // An item that draws nothing still has its place: on iOS 26 an empty glass circle (useHeaderBell).
    expect(sources.filter(({ text }) => /headerRight:\s*\(\)\s*=>\s*<HeaderBell/.test(text)).map(({ file }) => file)).toEqual([]);
  });
});

/*
  iOS's own push slid a page's bar one way and the page the other under the
  app's right to left (the owner's iPhone, in Expo Go): every stack slides a
  page in whole, the bar with it, from the side the reading starts on.
*/
describe('a page opened in a stack', () => {
  it('slides in whole, the way react-native-screens turns with the app', () => {
    const options = sources.find(({ file }) => file === join('components', 'navigation', 'stack-options.ts'));
    expect(options?.text).toMatch(/animation:\s*'simple_push'/);
    // No screen puts iOS's own push back.
    expect(sources.filter(({ text }) => /animation:\s*'(default|ios_from_right|slide_from_right)'/.test(text)).map(({ file }) => file)).toEqual([]);
  });
});
