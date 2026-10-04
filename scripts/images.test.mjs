/**
 * Every company logo and profile photo goes through reencodeImage before it is
 * stored in a public bucket: decoded, turned upright, shrunk and written again
 * as a WebP with nothing but pixels in it. Here it is given real pictures.
 *
 *   pnpm test:images
 *
 * The pictures are made with the same library, which is what the decoder has
 * to understand; the point is what comes out. This is also what stands
 * between an upgrade of sharp and a photo stored sideways, or with the place
 * it was taken still in it.
 */
import { register } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { reencodeImage } = await import('../src/lib/security/files.ts');
const { sniffKind } = await import('../src/lib/security/magic.ts');

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const canvas = (width, height) => sharp({ create: { width, height, channels: 3, background: '#7a1f2b' } });

console.log('\n— a phone photo');
{
  // Taken holding the phone upright: stored 40 wide and 20 high, with the
  // orientation tag saying to turn it, and a note in the EXIF block.
  const marker = 'GPS 30.0444N 31.2357E';
  const photo = await canvas(40, 20)
    .jpeg()
    .withExif({ IFD0: { Copyright: marker } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  check('the picture going in carries the note', photo.includes(Buffer.from(marker)));
  const out = await reencodeImage(photo);
  check('comes out', out !== null);
  check('as a WebP', out !== null && sniffKind(new Uint8Array(out.bytes)) === 'webp');
  check('turned upright', out?.width === 20 && out?.height === 40, `${out?.width}×${out?.height}`);
  const meta = out ? await sharp(out.bytes).metadata() : null;
  check('with no EXIF block', meta !== null && meta.exif === undefined);
  check('and the note nowhere in it', out !== null && !out.bytes.includes(Buffer.from(marker)));
  check('nor an orientation left to apply twice', meta !== null && (meta.orientation ?? 1) === 1);
}

console.log('\n— sizes and formats');
{
  const big = await reencodeImage(await canvas(3000, 1500).png().toBuffer());
  check('a large PNG fits inside 1024', big?.width === 1024 && big?.height === 512, `${big?.width}×${big?.height}`);
  const small = await reencodeImage(await canvas(300, 200).webp().toBuffer());
  check('a small WebP keeps its size', small?.width === 300 && small?.height === 200, `${small?.width}×${small?.height}`);
  const square = await reencodeImage(await canvas(64, 64).jpeg().toBuffer(), { maxSide: 32 });
  check('a smaller bound is honoured', square?.width === 32 && square?.height === 32, `${square?.width}×${square?.height}`);
}

console.log('\n— what is refused');
{
  // A canvas of 90 million pixels in a file of a few hundred bytes.
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(9500, 0);
  header.writeUInt32BE(9500, 4);
  header[8] = 8; // bits per sample
  header[9] = 2; // RGB
  const bomb = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(1024))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  check('a decompression bomb', (await reencodeImage(bomb)) === null);
  // And the limit itself, forty million pixels, from either side of it.
  const under = await reencodeImage(await canvas(6000, 6600).png().toBuffer());
  check('a picture just under the limit is read', under?.width === 931 && under?.height === 1024, `${under?.width}×${under?.height}`);
  check('one just over it is not', (await reencodeImage(await canvas(6400, 6400).png().toBuffer())) === null);
  check('bytes that are no picture', (await reencodeImage(Buffer.from('not a picture at all, only words'))) === null);
  check('nothing', (await reencodeImage(new Uint8Array())) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
