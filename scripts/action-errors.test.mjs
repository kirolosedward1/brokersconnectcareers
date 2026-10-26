/**
 * That no server action hands the database's own sentence to its caller.
 *
 *   node --experimental-strip-types scripts/action-errors.test.mjs
 *
 * `return { ok: false, error: error.message }` sent Postgres and PostgREST's
 * text — constraint names, RLS policy names, sometimes the value that broke
 * them — to the browser and, through /api/mobile/v1/actions, to the app, as
 * if it were an error code. Actions answer a short code instead and log the
 * Postgres code with the ids (observe.refused). This keeps the old line from
 * coming back, and keeps refused() from writing the sentence to the log.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { refused } = await import('../src/lib/observe.ts');

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

/** A message returned as the error itself, or defaulted into it. */
const RAW = [/\berror:\s*[\w$.]+\??\.message\b/, /\?\.message\s*\?\?/];
const raw = (line) => RAW.some((pattern) => pattern.test(line));

console.log('— the pattern');
is('error: error.message', raw("  if (error) return { ok: false, error: error.message };"), true);
is('another name', raw("  if (deadError) return { ok: false, error: deadError.message };"), true);
is('optional, with a default', raw("return { ok: false, error: error?.message ?? 'insert_failed' };"), true);
is('wrapped, with a default', raw("return { ok: false, error: capMessage(error?.message ?? 'failed') };"), true);
is('a code', raw("return { ok: false, error: 'failed' };"), false);
is('a message mapped to a code', raw('return { ok: false, error: mapJobError(error.message) };'), false);
is('a message read for a code', raw("if (error.message.includes('saved_search_cap')) return { ok: false, error: 'cap' };"), false);

console.log('— src/lib/actions');
const root = new URL('../src/lib/actions/', import.meta.url).pathname;
const files = readdirSync(root, { recursive: true }).filter((file) => /\.tsx?$/.test(file));
is('there are actions to read', files.length > 0, true);
const found = [];
for (const file of files) {
  readFileSync(join(root, file), 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (!line.trim().startsWith('//') && !line.trim().startsWith('*') && raw(line)) {
        found.push(`src/lib/actions/${file}:${index + 1}: ${line.trim()}`);
      }
    });
}
for (const site of found) console.log(`        ${site}`);
is('no action returns a raw error message', found.length, 0);

console.log('— what refused() leaves behind');
const lines = [];
const warn = console.warn;
console.warn = (line) => lines.push(String(line));
const answer = refused(
  'saved-search',
  {
    code: '23514',
    message: 'new row for relation "saved_searches" violates check constraint "saved_searches_label_check": أحمد 01001234567',
  },
  { user: '7d1c3f0a-0000-4000-8000-000000000001' },
);
console.warn = warn;

is('answers failed', answer.error, 'failed');
is('answers not ok', answer.ok, false);
is('the answer has nothing else', Object.keys(answer).sort().join(','), 'error,ok');
is('logs one line', lines.length, 1);
is('the line has the code', lines[0]?.includes('code=23514'), true);
is('the line has the id', lines[0]?.includes('user=7d1c3f0a-0000-4000-8000-000000000001'), true);
is('the line has no relation name', lines[0]?.includes('saved_searches'), false);
is('the line has no constraint name', lines[0]?.includes('check constraint'), false);
is('the line has none of the value', lines[0]?.includes('01001234567'), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
