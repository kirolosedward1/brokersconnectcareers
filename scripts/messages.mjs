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
 *   1. ar and en carry the same keys, with the same placeholders.
 *   2. No message containing a tag is read with plain t().
 *   3. Every key a component asks for exists.
 *   4. Every key the catalogue holds is asked for.
 *   5. No `.numeral` — which forces left-to-right — wraps a translated string.
 *
 * All of them are greps, not parses: `t('key')`-shaped calls, matched without
 * a TypeScript program. Checks 3 and 4 are the same scan run in opposite
 * directions, and the pair matters more than either half. One catches a raw
 * key path rendering on a page. The other catches copy written for a feature
 * nobody built — which is how this codebase carried the words for a password
 * reset for months without carrying the reset.
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
  /**
   * Argument names only.
   *
   * Two things get mistaken for arguments and both had to be excluded, each
   * after a real message tripped the check.
   *
   * The literal "1" in `one {1 vacancy}` — the Arabic branches spell their
   * numbers and the English ones do not, so every plural message looked
   * mismatched. Requiring a comma or closing brace after the name fixed that.
   *
   * And a single-word branch body: `=0 {today}` is indistinguishable from
   * `{today}` once you are only pattern-matching braces. So the plural and
   * select branches are stripped first, innermost outward, and what remains
   * is the argument list.
   */
  const stripBranches = (value) => {
    let text = String(value);
    // No \b in front of `=`: it is not a word character, so there is no
    // boundary between the preceding space and it, and the `=0 {…}` branch
    // survived. Arabic passed anyway because its branch text is not \w —
    // which is precisely the kind of luck that hides a broken check.
    const branch = /(?:=\d+|\b(?:zero|one|two|few|many|other)\b)\s*\{[^{}]*\}/g;
    let previous;
    do {
      previous = text;
      text = text.replace(branch, '');
    } while (text !== previous);
    return text;
  };

  const placeholders = (value) =>
    [...new Set([...stripBranches(value).matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]))]
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

console.log('\n— every key a component asks for exists');
{
  const ar = new Map(flatten(load('ar')));

  const sources = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) sources.push(full);
    }
  })(join(ROOT, 'src'));

  const missing = [];
  let checked = 0;

  for (const file of sources) {
    const text = readFileSync(file, 'utf8');

    /**
     * Which namespaces each translator variable is bound to. Both forms appear
     * here: useTranslations in client components, getTranslations in server
     * ones — the latter either positionally or as a namespace option.
     *
     * A list per variable, not one namespace, because `t` is routinely rebound
     * in a second function in the same file: the root layout binds it to
     * `meta` inside generateMetadata and to `nav` in the component below. This
     * is a regex, not a scope analysis, so it accepts a key that resolves
     * under any of a variable's namespaces. That is a deliberate relaxation —
     * it still catches a key that exists in none, which is the failure that
     * reaches a reader as a raw key on the page.
     */
    const namespaces = new Map();
    const binding =
      /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:\{[^}]*namespace:\s*)?['"`]([\w.]+)['"`]/g;
    for (const match of text.matchAll(binding)) {
      const list = namespaces.get(match[1]) ?? [];
      list.push(match[2]);
      namespaces.set(match[1], list);
    }

    for (const [variable, list] of namespaces) {
      // `t('x')` and `t.rich('x')`. Template literals are skipped on purpose:
      // a key built at runtime cannot be resolved here, and guessing at one
      // would report failures that are not real.
      const call = new RegExp(`\\b${variable}(?:\\.rich)?\\((['"])([\\w.]+)\\1`, 'g');
      for (const match of text.matchAll(call)) {
        checked += 1;
        if (!list.some((namespace) => ar.has(`${namespace}.${match[2]}`))) {
          missing.push(`${list.join('|')}.${match[2]} in ${file.replace(ROOT + '/', '')}`);
        }
      }
    }
  }

  check(`every literal key resolves (${checked} call sites)`, missing.length === 0,
    [...new Set(missing)].join('; '));
}

/**
 * Keys the catalogue keeps on purpose, with nothing calling them yet.
 *
 * Every entry is copy written for work that is planned and named, not copy
 * left behind. An allowlist rather than silence, so each exception is a
 * decision somebody wrote down and has to keep re-justifying.
 */
const PLANNED = new Map([
  ['auth.forgotPassword', 'password reset — round 4, track 1'],
  ['auth.resetPassword', 'password reset — round 4, track 1'],
  ['auth.sendResetLink', 'password reset — round 4, track 1'],
  ['filters.governorate', 'governorate filter — round 4, track 5'],
]);

console.log('\n— every key in the catalogue is asked for');
{
  // The direction this check was missing for months. Going the other way
  // proves nothing renders a raw key path; going this way proves the
  // catalogue is not carrying copy for features that were never built.
  //
  // It is the check that would have said, the week the copy landed, that
  // auth.forgotPassword had no caller — which is how a job board shipped with
  // no way to recover a password.
  const ar = new Map(flatten(load('ar')));

  const sources = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) sources.push(full);
    }
  })(join(ROOT, 'src'));

  const used = new Set();
  /**
   * Namespaces and prefixes reached by a key built at runtime, which no grep
   * can resolve. Two shapes, both detected rather than listed by hand:
   * `t(`orderStatus.${x}`)` contributes the prefix it starts with, and
   * `t(someVariable)` contributes its whole namespace.
   */
  const dynamic = new Set();

  for (const file of sources) {
    const text = readFileSync(file, 'utf8');

    const namespaces = new Map();
    const binding =
      /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:\{[^}]*namespace:\s*)?['"`]([\w.]+)['"`]/g;
    for (const match of text.matchAll(binding)) {
      const list = namespaces.get(match[1]) ?? [];
      list.push(match[2]);
      namespaces.set(match[1], list);
    }

    for (const [variable, list] of namespaces) {
      for (const match of text.matchAll(
        new RegExp(`\\b${variable}(?:\\.rich)?\\((['"])([\\w.]+)\\1`, 'g'),
      )) {
        for (const namespace of list) used.add(`${namespace}.${match[2]}`);
      }

      // t(`stem.${…}`) — everything under the static stem is reachable.
      for (const match of text.matchAll(
        new RegExp('\\b' + variable + '(?:\\.rich)?\\(\\s*`([\\w.]*)\\$\\{', 'g'),
      )) {
        for (const namespace of list) dynamic.add(`${namespace}.${match[1]}`);
      }

      // t(value) — an identifier, not a string. The whole namespace is in play.
      if (new RegExp('\\b' + variable + '(?:\\.rich)?\\(\\s*[A-Za-z_$]').test(text)) {
        for (const namespace of list) dynamic.add(`${namespace}.`);
      }
    }
  }

  const prefixes = [...dynamic];
  const orphans = [...ar.keys()].filter(
    (key) =>
      !used.has(key) &&
      !PLANNED.has(key) &&
      !prefixes.some((prefix) => key.startsWith(prefix)),
  );

  check(`no key in the catalogue is unreachable (${ar.size} keys, ${PLANNED.size} planned)`,
    orphans.length === 0, orphans.join(', '));

  const stale = [...PLANNED.keys()].filter((key) => !ar.has(key));
  check('and nothing is allowlisted that no longer exists', stale.length === 0, stale.join(', '));
}

console.log('\n— no translated phrase is forced left-to-right');
{
  /**
   * `.numeral` sets `direction: ltr`. That is right for a figure and wrong for
   * a sentence: wrap a translated string in it and an Arabic reader meets the
   * last word first — a salary range reads high-to-low, "تنتهي في {date}"
   * puts the date before the words.
   *
   * I shipped this bug on the job card, fixed it, and then wrote it again
   * from scratch in three other places within the day. Hence a check rather
   * than a resolution to be careful.
   *
   * It looks for a `numeral` class whose element contains a translator call.
   * Numbers passed *into* a message are fine and common — `t('x', { count })`
   * — so only a `t(...)` inside the numeral element counts.
   */
  const sources = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry)) sources.push(full);
    }
  })(join(ROOT, 'src'));

  const offenders = [];
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      if (!/className=(?:"|{`|')[^"'`]*\bnumeral\b/.test(line)) return;
      const call = /\b[a-zA-Z]*[tT](?:\.rich)?\((['"`])[\w.]+\1/;
      const rest = line.slice(line.search(/\bnumeral\b/));

      /**
       * The element's own body, found by indentation.
       *
       * JSX here is indentation-formatted, so the element ends at the first
       * following line indented no further than its opening tag. That is what
       * separates "inside this numeral" from "underneath it", and both
       * earlier attempts got it wrong in opposite directions: a fixed
       * three-line window named twenty-five files, most of them a numeral
       * holding a bare figure with unrelated prose below; checking only the
       * first child then missed the real one, where an icon comes first and
       * the translated string second.
       */
      const indent = line.search(/\S/);
      const body = [rest];
      if (/>\s*$/.test(line) && !/\/>\s*$/.test(line)) {
        for (let i = index + 1; i < lines.length && i < index + 12; i += 1) {
          const next = lines[i];
          if (next.trim() && next.search(/\S/) <= indent) break;
          body.push(next);
        }
      }

      if (body.some((entry) => call.test(entry))) {
        offenders.push(`${file.replace(ROOT + '/', '')}:${index + 1}`);
      }
    });
  }

  check(`no .numeral wraps a translated string (${sources.length} components)`,
    offenders.length === 0, offenders.join('; '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
