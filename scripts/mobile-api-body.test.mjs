/**
 * The mobile API's door reads a body no further than its limit.
 *
 *   node --experimental-strip-types scripts/mobile-api-body.test.mjs
 *
 * A declared length over the limit was refused before reading, but a body
 * sent without one (chunked) went through request.text() / formData(), which
 * held all of it in memory before its size was looked at. readWithin counts
 * it as it arrives and stops at the first byte past the limit; and the door
 * reads through it (src/lib/mobile-api/http.ts).
 */
import { readFileSync } from 'node:fs';

const { readWithin } = await import('../src/lib/mobile-api/body.ts');

let pass = 0;
let fail = 0;
function is(label, got, want) {
  if (got === want) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const KB = 1024;

/** A chunked body of `chunks` pieces of `size` bytes, counting how many the reader pulled. */
function stream(chunks, size) {
  const state = { pulled: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      if (state.pulled === chunks) return controller.close();
      state.pulled += 1;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { body, state };
}

console.log('— a body without a declared length');
{
  // 64 MB sent in 64 KB pieces against a 256 KB limit.
  const { body, state } = stream(1024, 64 * KB);
  const read = await readWithin(body, 256 * KB);
  is('is refused as too large', 'tooLarge' in read, true);
  is('after reading only just past the limit, not all of it', state.pulled <= 5, true);
  is('and the sender is told to stop', state.cancelled, true);
}

{
  // What the old door did with the same body: everything first.
  const { body, state } = stream(1024, 64 * KB);
  const text = await new Response(body).text();
  is('(request.text() took in all 64 MB to judge it)', state.pulled === 1024 && text.length === 64 * 1024 * KB, true);
}

console.log('\n— a body within the limit');
{
  const { body } = stream(3, 10 * KB);
  const read = await readWithin(body, 256 * KB);
  is('is read whole', 'bytes' in read && read.bytes.byteLength, 30 * KB);
}
{
  const json = JSON.stringify({ input: { name: 'شركة' } });
  const read = await readWithin(new Response(json).body, 256 * KB);
  is('and decodes to what was sent', new TextDecoder().decode(read.bytes), json);
}
{
  const read = await readWithin(null, 10);
  is('no body is an empty one', 'bytes' in read && read.bytes.byteLength, 0);
}
{
  const { body } = stream(1, 256 * KB);
  const read = await readWithin(body, 256 * KB);
  is('exactly the limit is allowed', 'bytes' in read, true);
}

console.log('\n— multipart, parsed from the counted bytes');
{
  const form = new FormData();
  form.set('kind', 'avatar');
  form.set('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'a.jpg');
  const sent = new Request('https://x.invalid', { method: 'POST', body: form });
  const read = await readWithin(sent.body, 3 * 1024 * KB);
  const parsed = await new Response(read.bytes, { headers: { 'content-type': sent.headers.get('content-type') } }).formData();
  is('keeps its fields', parsed.get('kind'), 'avatar');
  is('and its file', (await parsed.get('file').arrayBuffer()).byteLength, 3);
}

console.log('\n— the door reads through it');
{
  const http = readFileSync(new URL('../src/lib/mobile-api/http.ts', import.meta.url), 'utf8');
  const door = http.slice(http.indexOf('export async function readActionInput'));
  is('readActionInput uses readWithin', door.includes('readWithin(request.body'), true);
  is('and never request.text()', door.includes('request.text()'), false);
  is('nor request.formData()', door.includes('request.formData()'), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
