#!/usr/bin/env node
/**
 * Checks on the message catalogue.
 *
 * Both of these existed as things I did by hand and therefore sometimes did
 * not do. The second one is here because of a bug it would have caught:
 * teaching a message a rich tag, to isolate digits inside Arabic prose, and
 * leaving a caller on plain `t()` — which cannot render tags and silently
 * prints the key path instead. A dropdown in the employer's posting form read
 * "commissionType.percentage" in production for exactly as long as it took
 * somebody to open it.
 *
 *   1. ar and en carry the same keys.
 *   2. No message containing a tag is read with plain t().
 *
 * The second is a grep, not a parse. It looks for `t('key')`-shaped calls that
 * are not `t.rich(`, which catches the mistake without a TypeScript program.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const load = (locale) =>
  JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf8'));

function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

console.log('\n— the two catalogues agree');
{
  const ar = new Map(flatten(load('ar')));
  const en = new Map(flatten(load('en')));

  const onlyAr = [...ar.keys()].filter((key) => !en.has(key));
  const onlyEn = [...en.keys()].filter((key) => !ar.has(key));

  check(`ar and en have the same keys (${ar.size})`, onlyAr.length === 0 && onlyEn.length === 0,
    [...onlyAr.map((k) => `ar only: ${k}`), ...onlyEn.map((k) => `en only: ${k}`)].join(', '));

  // A placeholder present in one language and missing in the other renders as
  // a blank where a number should be.
  // Argument names only. A bare `\{(\\w+)` also matches the literal "1" in
  // `one {1 vacancy}`, which made every plural message look mismatched — the
  // Arabic branches spell their numbers and the English ones do not. An
  // argument is always followed by a comma or a closing brace.
  const placeholders = (value) =>
    [...new Set([...String(value).matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]))]
      .sort()
      .join(',');
  const mismatched = [...ar.entries()]
    .filter(([key, value]) => en.has(key) && placeholders(value) !== placeholders(en.get(key)))
    .map(([key]) => key);
  check('and the same placeholders in each', mismatched.length === 0, mismatched.join(', '));
}

console.log('\n— tagged messages are read with t.rich');
{
  const tagged = flatten(load('ar'))
    .filter(([, value]) => /<\w+>/.test(String(value)))
    .map(([key]) => key);

  const sources = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) sources.push(full);
    }
  })(join(ROOT, 'src'));

  const code = sources.map((file) => [file, readFileSync(file, 'utf8')]);

  const offenders = [];
  for (const key of tagged) {
    const leaf = key.split('.').pop();
    for (const [file, text] of code) {
      // Any identifier called directly with the key — `t('x')`,
      // `tCompensation('x')` — but not a member call, which is what `t.rich('x')`
      // is. The lookbehind is what separates them: in `t.rich(`, the identifier
      // sitting before the paren is `rich`, and it is preceded by a dot.
      //
      // The first draft required the variable to end in `t`, so it matched
      // `t(` and `tJobs(` and missed `tCompensation(` — which is precisely the
      // call that shipped the bug. Verified now by reintroducing it.
      const plain = new RegExp(`(?<![.\\w])\\w+\\((['"\`])${leaf}\\1`, 'g');
      if (plain.test(text)) offenders.push(`${key} in ${file.replace(ROOT + '/', '')}`);
    }
  }

  check(`every tagged message (${tagged.length}) is rendered with t.rich`,
    offenders.length === 0, offenders.join('; '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
