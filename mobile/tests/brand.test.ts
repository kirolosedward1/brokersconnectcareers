import { LOCKUP } from '~/components/brand/brand-logo';

// Node's own modules, required as tests/server.ts does: the app's typings have no Node in them.
/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync } = require('node:fs') as { readFileSync: (path: string) => Uint8Array & { equals: (other: unknown) => boolean } };
const { join } = require('node:path') as { join: (...parts: string[]) => string };
const { inflateSync } = require('node:zlib') as { inflateSync: (data: Uint8Array) => Uint8Array };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

const app = (...path: string[]) => readFileSync(join(__dirname, '..', 'assets', 'brand', ...path));
const site = (...path: string[]) => readFileSync(join(__dirname, '..', '..', 'public', 'brand', ...path));

/*
  The app's logo is the website's: copied into the app because Metro bundles
  only what is under mobile/ and the folders it is told to watch. A new logo
  on the website fails this until the app has it too.
*/
it("is the website's own mark, byte for byte", () => {
  expect(app('logo-mark.png').equals(site('logo-mark.png'))).toBe(true);
});

/* The welcome's photograph is the website's hero, the same file: a new one on the website fails this until the app has it too. */
it("opens on the website's own hero photograph, byte for byte", () => {
  const welcome = readFileSync(join(__dirname, '..', 'assets', 'images', 'welcome-photo.jpg'));
  const hero = readFileSync(join(__dirname, '..', '..', 'public', 'media', 'hero-poster.jpg'));
  expect(welcome.equals(hero)).toBe(true);
});

/*
  The lockup (public/brand/logo-ar.png) comes in two parts, its wordmark and
  its mark, cut at the gap between them so the wordmark alone can take the
  page's ink in dark mode. Put back side by side at that gap, they are the
  website's file, pixel for pixel. Cut again from a new logo with any PNG
  tool: the wordmark up to the first empty column of the gap, the mark from
  the column after the last, each its full height; then LOCKUP takes the new
  widths.
*/
it("draws the website's own logo, cut in two at the gap between its wordmark and its mark", () => {
  const lockup = decode(site('logo-ar.png'));
  const wordmark = decode(app('logo-wordmark-ar.png'));
  const mark = decode(app('logo-lockup-mark.png'));

  expect([wordmark.width, wordmark.height]).toEqual([LOCKUP.wordmark, LOCKUP.height]);
  expect([mark.width, mark.height]).toEqual([LOCKUP.mark, LOCKUP.height]);
  expect(lockup.height).toBe(LOCKUP.height);
  expect(LOCKUP.wordmark + LOCKUP.gap + LOCKUP.mark).toBe(lockup.width);

  let differing = 0;
  let drawnAtAll = 0;
  for (let y = 0; y < lockup.height; y++) {
    for (let x = 0; x < lockup.width; x++) {
      const expected = lockup.pixel(x, y);
      if (expected[3] > 0) drawnAtAll++;
      const drawn =
        x < LOCKUP.wordmark
          ? wordmark.pixel(x, y)
          : x < LOCKUP.wordmark + LOCKUP.gap
            ? [0, 0, 0, 0]
            : mark.pixel(x - LOCKUP.wordmark - LOCKUP.gap, y);
      // Wholly transparent is transparent, whatever colour it carries.
      const same = expected[3] === 0 ? drawn[3] === 0 : expected.every((value, channel) => value === drawn[channel]);
      if (!same) differing++;
    }
  }
  expect(differing).toBe(0);
  // A logo, not an empty canvas: the comparison above saw its ink.
  expect(drawnAtAll).toBeGreaterThan(lockup.width * lockup.height * 0.2);
});

/** An 8-bit RGBA PNG, decoded: what the logo files are. */
function decode(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let width = 0;
  let height = 0;
  const data: Uint8Array[] = [];
  for (let at = 8; at < file.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      expect([body[8], body[9], body[12]]).toEqual([8, 6, 0]); // 8-bit, RGBA, not interlaced
    }
    if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const joined = new Uint8Array(data.reduce((sum, part) => sum + part.length, 0));
  data.reduce((offset, part) => (joined.set(part, offset), offset + part.length), 0);
  const raw = inflateSync(joined);

  const stride = width * 4;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = raw[y * (stride + 1) + 1 + x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const guess = left + up - corner;
        const [a, b, c] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - corner)];
        value += a <= b && a <= c ? left : b <= c ? up : corner;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return {
    width,
    height,
    pixel: (x: number, y: number) => Array.from(pixels.subarray(y * stride + x * 4, y * stride + x * 4 + 4)),
  };
}
