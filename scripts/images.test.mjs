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

const { isHeicBytes, isHeicFile, compressionSteps, storageDetail, imageFailureCopy, deadline, HEIC_TIMEOUT_MS, PREPARING_IMAGE_AFTER_MS, IMAGE_ACCEPT, pickHeicFrame } = await import(
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
  check('the picker offers jpeg, png and webp only', IMAGE_ACCEPT === 'image/jpeg,image/png,image/webp');
  const full = { primary: true, width: 4032, height: 3024 };
  const preview = { primary: false, width: 384, height: 512 };
  check('the primary frame is kept, not the preview', pickHeicFrame([preview, full]) === full);
  check('a preview wearing the primary flag loses to the full frame', pickHeicFrame([{ ...preview, primary: true }, { ...full, primary: false }])?.width === 4032);
  check('with no flag, the largest frame is the photograph', pickHeicFrame([{ ...preview, primary: false }, { ...full, primary: false }])?.width === 4032);
  check('a single primary frame is that frame', pickHeicFrame([full]) === full);
  check('the status line waits about three seconds', PREPARING_IMAGE_AFTER_MS === 3_000);
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
    imageUnreadable: 'unreadable',
    imageTooLarge: 'large',
    uploadRateLimited: 'rate',
    storageError: 'storage:',
    generic: 'generic',
  };
  check('the storage sentence is kept whole', imageFailureCopy('storage', 'new row violates row-level security policy', copy) === 'storage: new row violates row-level security policy');
  check('a picture of the wrong kind says so', imageFailureCopy('file_type', undefined, copy) === 'type');
  check('a picture that could not be read says so', imageFailureCopy('unreadable', undefined, copy) === 'unreadable');
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

const { readFileSync } = await import('node:fs');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const libheif = require('libheif-js/wasm-bundle');
const { decodeHeicPrimary, pixelsAreMostlyOneValue } = await import('../src/lib/heic-decode.ts');

function refusal(run) {
  try {
    run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : 'thrown';
  }
}

// A 64×64 HEVC picture in a real HEIC container. The pixels are a gradient,
// so a decoder that hands back one colour has not read it.
const gradient = new Uint8Array(readFileSync(new URL('./fixtures/gradient.heic', import.meta.url)));

function boxEnd(bytes, name) {
  let cursor = 0;
  while (cursor + 8 <= bytes.length) {
    let size = (bytes[cursor] << 24) | (bytes[cursor + 1] << 16) | (bytes[cursor + 2] << 8) | bytes[cursor + 3];
    const type = String.fromCharCode(bytes[cursor + 4], bytes[cursor + 5], bytes[cursor + 6], bytes[cursor + 7]);
    let header = 8;
    if (size === 1) {
      size = 0;
      for (let i = 0; i < 8; i++) size = size * 256 + bytes[cursor + 8 + i];
      header = 16;
    }
    if (type === name) return { cursor, size, header };
    cursor += size;
  }
  return null;
}

/** The same photograph four times, as a 2×2 grid. `cut` points the other three tiles past the end of the file. */
function gridOf(tile, mode) {
  const u16 = (n) => Buffer.from([(n >> 8) & 255, n & 255]);
  const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const box = (type, body) => Buffer.concat([u32(8 + body.length), Buffer.from(type), body]);
  const full = (type, version, flags, body) => box(type, Buffer.concat([Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), body]));
  const infe = (id, type, hidden) => full('infe', 2, hidden ? 1 : 0, Buffer.concat([u16(id), u16(0), Buffer.from(type), Buffer.from([0])]));
  const hdlr = Buffer.from(tile.subarray(40, 73));
  const hvcC = Buffer.from(tile.subarray(172, 292));
  const ispe64 = Buffer.from(tile.subarray(292, 312));
  const colr = Buffer.from(tile.subarray(312, 331));
  const pixi = Buffer.from(tile.subarray(331, 347));
  const payload = Buffer.from(tile.subarray(378, 487));
  const ispe128 = Buffer.from(ispe64);
  ispe128.writeUInt32BE(128, 12);
  ispe128.writeUInt32BE(128, 16);
  const gridBytes = Buffer.from([0x00, 0x00, 0x01, 0x01, 0x00, 0x80, 0x00, 0x80]);
  const ftyp = Buffer.from(tile.subarray(0, 28));
  const iinf = full('iinf', 0, 0, Buffer.concat([u16(5), infe(1, 'grid', false), infe(2, 'hvc1', true), infe(3, 'hvc1', true), infe(4, 'hvc1', true), infe(5, 'hvc1', true)]));
  const iref = full('iref', 0, 0, box('dimg', Buffer.concat([u16(1), u16(4), u16(2), u16(3), u16(4), u16(5)])));
  const ipco = box('ipco', Buffer.concat([hvcC, ispe64, colr, pixi, ispe128]));
  const assoc = (id, bytes) => Buffer.concat([u16(id), Buffer.from([bytes.length]), Buffer.from(bytes)]);
  const ipma = full('ipma', 0, 0, Buffer.concat([u32(5), assoc(1, [0x85, 0x04]), assoc(2, [0x81, 0x02, 0x03, 0x04]), assoc(3, [0x81, 0x02, 0x03, 0x04]), assoc(4, [0x81, 0x02, 0x03, 0x04]), assoc(5, [0x81, 0x02, 0x03, 0x04])]));
  const iprp = box('iprp', Buffer.concat([ipco, ipma]));
  const pitm = full('pitm', 0, 0, u16(1));
  const ilocSize = 8 + 4 + 2 + 2 + 5 * 14;
  const metaSize = 8 + 4 + hdlr.length + pitm.length + ilocSize + iinf.length + iref.length + iprp.length;
  const payloadAt = ftyp.length + metaSize + 8;
  const tileAt = payloadAt + gridBytes.length;
  const past = tileAt + payload.length + 80;
  const ilocBody = Buffer.alloc(2 + 2 + 5 * 14);
  ilocBody[0] = 0x44;
  ilocBody.writeUInt16BE(5, 2);
  const items = [
    [1, payloadAt, gridBytes.length],
    [2, tileAt, payload.length],
    [3, mode === 'cut' ? past : tileAt, payload.length],
    [4, mode === 'cut' ? past : tileAt, payload.length],
    [5, mode === 'cut' ? past : tileAt, payload.length],
  ];
  let cursor = 4;
  for (const [id, offset, length] of items) {
    ilocBody.writeUInt16BE(id, cursor);
    ilocBody.writeUInt16BE(1, cursor + 4);
    ilocBody.writeUInt32BE(offset, cursor + 6);
    ilocBody.writeUInt32BE(length, cursor + 10);
    cursor += 14;
  }
  const iloc = full('iloc', 0, 0, ilocBody);
  const meta = full('meta', 0, 0, Buffer.concat([hdlr, pitm, iloc, iinf, iref, iprp]));
  return new Uint8Array(Buffer.concat([ftyp, meta, box('mdat', Buffer.concat([gridBytes, payload]))]));
}

console.log('\n— a HEIC that is not a whole picture');
{
  const photo = decodeHeicPrimary(libheif, gradient);
  check('a complete HEIC is the photograph, at its own size', photo.width === 64 && photo.height === 64, `${photo.width}×${photo.height}`);
  check('and it is not one colour', !pixelsAreMostlyOneValue(photo.pixels, photo.width, photo.height));
  const solid = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < solid.length; i += 4) {
    solid[i + 1] = 136;
    solid[i + 3] = 255;
  }
  check('a field of one colour would be refused', pixelsAreMostlyOneValue(solid, 32, 32));
  const mostly = new Uint8Array(solid);
  mostly[0] = 20;
  mostly[1] = 40;
  mostly[2] = 60;
  check('so would a frame that is almost all that colour', pixelsAreMostlyOneValue(mostly, 32, 32));

  const mdat = boxEnd(gradient, 'mdat');
  const cut = gradient.subarray(0, mdat.cursor + mdat.header + 16);
  check('a HEIC cut short is refused', refusal(() => decodeHeicPrimary(libheif, cut)) === 'truncated');

  const junk = new Uint8Array(gradient);
  let state = 0x12345678;
  for (let i = mdat.cursor + mdat.header; i < junk.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    junk[i] = state & 255;
  }
  const junked = refusal(() => decodeHeicPrimary(libheif, junk));
  check('random bytes after a real header are refused', junked === 'decode' || junked === 'warning' || junked === 'truncated', junked);

  const whole = decodeHeicPrimary(libheif, gridOf(gradient, 'full'));
  check('a whole grid is the full frame, not one tile', whole.width === 128 && whole.height === 128, `${whole.width}×${whole.height}`);
  check('and that frame is still the photograph', !pixelsAreMostlyOneValue(whole.pixels, whole.width, whole.height));
  const shortGrid = refusal(() => decodeHeicPrimary(libheif, gridOf(gradient, 'cut')));
  check('a grid whose later tiles were cut off is refused', shortGrid === 'truncated' || shortGrid === 'warning' || shortGrid === 'decode', shortGrid);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
