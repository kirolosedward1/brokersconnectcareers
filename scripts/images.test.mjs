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

const { isHeicBytes, isHeicFile, compressionSteps, storageDetail, imageFailureCopy, deadline, HEIC_TIMEOUT_MS } = await import(
  '../src/lib/image-upload.ts'
);
const { fileType } = await import('../src/lib/file-type.ts');

console.log('\n— a picture chosen on the phone, before it is sent');
{
  const heic = new Uint8Array(12);
  heic.set([0x00, 0x00, 0x00, 0x18], 0);
  heic.set([...'ftyp'].map((c) => c.charCodeAt(0)), 4);
  heic.set([...'heic'].map((c) => c.charCodeAt(0)), 8);
  check('a HEIC ftyp box is a HEIC', isHeicBytes(heic));
  check('a JPEG is not a HEIC', !isHeicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])));
  check('IMG.HEIC is named as one', isHeicFile({ name: 'IMG.HEIC', type: '' }) && fileType({ name: 'IMG.HEIC', type: '' }) === 'image/heic');
  check('image/heic is named as one', isHeicFile({ name: 'photo', type: 'image/heic' }));
  check('a PNG is not', !isHeicFile({ name: 'logo.png', type: 'image/png' }) && fileType({ name: 'logo.png', type: '' }) === 'image/png');
  const steps = compressionSteps(4000, 1600);
  check('reduction starts at the cap', steps[0].edge === 1600);
  check(
    'and each later edge is smaller',
    steps.map((step) => step.edge).filter((edge, index, edges) => edges.indexOf(edge) === index).every((edge, index, edges) => index === 0 || edge < edges[index - 1]),
  );
  check('a storage sentence is one short line', storageDetail('  new   row \n violates  ') === 'new row violates');
  check('and it stops at 300 characters', storageDetail('x'.repeat(400)).length === 300);
  check('an empty storage sentence stays empty', storageDetail('   ') === '');
  const copy = {
    imageType: 'type',
    imageTooLarge: 'large',
    uploadRateLimited: 'rate',
    storageError: 'storage:',
    generic: 'generic',
  };
  check('the storage sentence is kept whole', imageFailureCopy('storage', 'new row violates row-level security policy', copy) === 'storage: new row violates row-level security policy');
  check('a picture of the wrong kind says so', imageFailureCopy('file_type', undefined, copy) === 'type');
  check('one that will not shrink says so', imageFailureCopy('too_large', undefined, copy) === 'large');
  check('anything else stays generic', imageFailureCopy('unavailable', undefined, copy) === 'generic');
  check('a HEIC conversion is given about 20 seconds', HEIC_TIMEOUT_MS === 20_000);
  check('a finished conversion is kept', (await deadline(Promise.resolve('jpeg'), 50)) === 'jpeg');
  let timedOut = false;
  try {
    await deadline(new Promise(() => {}), 30);
  } catch {
    timedOut = true;
  }
  check('a conversion that never answers is stopped', timedOut);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
