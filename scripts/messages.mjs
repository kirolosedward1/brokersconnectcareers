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
   * It looks for a `numeral` class whose element renders localised words.
   * Numbers passed *into* a message are fine and common — `t('x', { count })`
   * — so only a call whose *result* lands inside the numeral element counts.
   *
   * Two things count. Any of the file's own translator variables, discovered
   * from their useTranslations/getTranslations binding rather than guessed at
   * by name: the first version of this matched `[a-zA-Z]*[tT]\(`, which
   * requires the variable to end in a t, so it saw `t(` and quietly missed
   * `tJobs(`, `tCommon(`, `tStatus(` and every other. It passed for weeks with
   * two live bugs in front of it — a results count and a blog date, both
   * reading backwards in Arabic.
   *
   * And `formatDate`, which is not a translator but returns a month name:
   * "20 أغسطس 2026" is prose with digits in it, not a figure. formatNumber and
   * formatEgp return digits and separators only, so they belong in a numeral
   * and are deliberately not listed.
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

    // The translator variables this file actually binds, so the check does not
    // have to guess what they are called.
    const translators = new Set(['formatDate']);
    for (const match of text.matchAll(
      /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(/g,
    )) {
      translators.add(match[1]);
    }
    const call = new RegExp(
      `\\b(?:${[...translators].join('|')})(?:\\.rich)?\\(`,
    );

    lines.forEach((line, index) => {
      if (!/className=(?:"|{`|')[^"'`]*\bnumeral\b/.test(line)) return;
      // Stop at the element's own closing tag. Without this a numeral that
      // opens and closes on one line swallowed whatever followed it on that
      // line — the footer's `<span class="numeral">{year}</span> · {siteName}`
      // was reported for a translator call that is not inside the span at all.
      let rest = line.slice(line.search(/\bnumeral\b/));
      const closes = rest.indexOf('</');
      if (closes !== -1) rest = rest.slice(0, closes);

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
      /*
        Indentation is measured from the line that opens the tag, which is not
        always the line the class is on. In the multi-line shape below the
        className attribute sits two spaces deeper than `<time`, level with
        the children — measured from there, the first child line looked like
        the end of the element and the scan stopped before reading it.
      */
      let openStart = index;
      while (openStart > 0 && !/^\s*<[^/]/.test(lines[openStart])) openStart -= 1;
      const indent = lines[openStart].search(/\S/);
      const body = [rest];

      /*
        The opening tag does not always end on the line the class is written
        on. A tag broken over several lines puts className in the middle of
        its own attributes:

          <time
            dateTime={...}
            className="numeral text-xs"
          >
            {t('appliedOn', { date: formatDate(...) })}
          </time>

        The first version tested the className line for a trailing `>`, found
        none, and concluded the element had no body — so it read the class,
        skipped the children, and passed. That is exactly the shape the check
        exists for, and it sat in the candidate's applications list reading
        the date before the words for as long as the check has existed.

        Attribute lines are stepped over rather than scanned: a translated
        title or aria-label is not laid out, so its direction is nobody's
        problem.
      */
      let openEnd = index;
      /*
        Only when the element is still open. An element that opens and closes
        on its own line — `const v = (chunks) => <span className="numeral">
        {chunks}</span>;`, or a figure inside a paragraph — has no body
        underneath it, and scanning forward for the next line ending in `>`
        found some later element and read *its* children instead. That is how
        the rich-tag helper every compensation component defines got reported
        as wrapping a translated string.
      */
      if (closes === -1) {
        while (
          openEnd < lines.length &&
          openEnd < index + 12 &&
          !/>\s*$/.test(lines[openEnd])
        ) {
          openEnd += 1;
        }
      }

      const opener = lines[openEnd] ?? '';
      if (closes === -1 && /}?>\s*$/.test(opener) && !/\/>\s*$/.test(opener)) {
        for (let i = openEnd + 1; i < lines.length && i < openEnd + 12; i += 1) {
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

console.log('\n— the browser gets the messages it needs and no more');

/*
  next-intl serialises whatever the client provider is given into the HTML, and
  given nothing it gives everything: a visitor to /jobs was downloading the
  moderation queue's copy, the job wizard, the CV editor and the account
  screen — 14 KB of the 67 KB that page weighs compressed, on a market that is
  almost entirely mobile.

  Two lists now decide what crosses over, and a stale list is a
  MISSING_MESSAGE on whichever screen nobody opened before deploying. So the
  lists are checked against what client components actually ask for, read off
  the source rather than trusted.
*/
{
  const listing = readFileSync(join(ROOT, 'src/i18n/client-messages.ts'), 'utf8');
  const listOf = (name) => {
    const body = listing.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? '';
    return [...body.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  };
  const publicPaths = listOf('PUBLIC_MESSAGES');
  const consolePaths = listOf('CONSOLE_MESSAGES');

  check('both lists were read', publicPaths.length > 0 && consolePaths.length > 0,
    `${publicPaths.length} public, ${consolePaths.length} console`);

  /* The console's own client components; everything else is the public site. */
  const CONSOLE_DIRS = [
    'src/components/admin/',
    'src/components/employer/',
    'src/components/dashboard/',
    'src/app/[locale]/(app)/',
  ];

  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  })(join(ROOT, 'src'));

  const usage = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!/^['"]use client['"]/m.test(text)) continue;
    const relative = file.replace(ROOT + '/', '');
    // Quote-agnostic, like the two scanners above it: a handful of files in
    // this codebase are double-quoted, and a scanner that only sees single
    // quotes reports their namespaces as unread and invites deleting them.
    for (const match of text.matchAll(/useTranslations\(\s*['"`]([\w.]+)['"`]/g)) {
      usage.push({ relative, namespace: match[1] });
    }
  }

  check(`read ${usage.length} client-side namespace reads`, usage.length > 20);

  // A read is covered by an exact path or by an ancestor of it.
  const covers = (paths, namespace) =>
    paths.some((path) => namespace === path || namespace.startsWith(`${path}.`));

  const both = [...publicPaths, ...consolePaths];
  const uncovered = usage.filter(({ relative, namespace }) => {
    const isConsole = CONSOLE_DIRS.some((dir) => relative.startsWith(dir));
    return !covers(isConsole ? both : publicPaths, namespace);
  });

  check('every client component can reach the namespace it reads',
    uncovered.length === 0,
    uncovered.slice(0, 6).map((u) => `${u.relative} needs ${u.namespace}`).join('; '));

  // And nothing is shipped that nothing reads — a list nobody prunes grows
  // back into the whole catalogue.
  const unread = both.filter(
    (path) => !usage.some(({ namespace }) => namespace === path || namespace.startsWith(`${path}.`)),
  );
  check('nothing is listed that no client component reads', unread.length === 0, unread.join(', '));

  // Every path names something real.
  const catalogue = load('ar');
  const missing = both.filter((path) => {
    let node = catalogue;
    for (const segment of path.split('.')) {
      if (node == null || typeof node !== 'object') return true;
      node = node[segment];
    }
    return node === undefined;
  });
  check('every listed path exists in the catalogue', missing.length === 0, missing.join(', '));
}

console.log('\n— no Arabic is written into a component');

/*
  Six labels were spelled into two forms rather than translated — three in
  Arabic, three in English. The English three sat on an Arabic-only screen, so
  an employer filling in their company profile met "Company name (English)" and
  "About (English)" among a dozen Arabic labels. Nothing caught it: the checks
  above prove every key that is asked for exists and every key that exists is
  asked for, and a string that never becomes a key is invisible to both.

  Arabic in a comment is fine and there is a lot of it — the comments in this
  codebase quote the copy they are about. So comments come out first, and what
  is left is code.
*/
{
  /*
    src/app and src/components — where copy is rendered. Not src/lib, which
    holds character data rather than words: the Arabic-to-Western numeral map,
    the letter forms search normalises, the country's phone prefixes, and the
    email copy module, which is out of the catalogue on purpose because
    next-intl ships the whole bundle to the browser and twenty templates' worth
    of strings only the mail server reads would go with it.

    The gap that leaves is a helper in src/lib returning a rendered phrase.
    Nothing does that today, and a rule with six exceptions stops being read.
  */
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  })(join(ROOT, 'src/app'));
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) files.push(full);
    }
  })(join(ROOT, 'src/components'));

  /*
    Three files may hold Arabic, each for a reason that is not "forgot to
    translate it":

    global-error.tsx replaces the document when the root layout itself has
    failed, which is precisely when next-intl is not available to ask.

    illustrations.tsx draws its own labels inside an SVG and switches them on a
    locale prop — the words are artwork, positioned by hand against the shapes
    around them.

    onboarding-form.tsx names each language in its own language, because a
    language switcher has to be readable by somebody who cannot read the
    language currently selected.
  */
  const ALLOWED = new Set([
    'src/app/global-error.tsx',
    'src/components/home/illustrations.tsx',
    'src/components/auth/onboarding-form.tsx',
    // The web app manifest: static metadata a phone reads once when somebody
    // adds the site to their home screen, in the one language it is served in.
    'src/app/manifest.ts',
  ]);

  const ARABIC = /[\u0600-\u06ff]/;
  const offenders = [];

  for (const file of files) {
    const relative = file.replace(ROOT + '/', '');
    if (ALLOWED.has(relative)) continue;

    /*
      Blanked, not deleted. The first version of this removed comments
      outright and then reported the line numbers of what was left, which no
      longer matched the file — every offender it named was a comment several
      lines further up, and the four it found were all phantoms.
    */
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
      .replace(/^(\s*)\/\/.*$/gm, '$1');

    code.split('\n').forEach((line, index) => {
      if (ARABIC.test(line)) offenders.push(`${relative}:${index + 1}`);
    });
  }

  check(
    `no Arabic literal outside the catalogue (${files.length} files, ${ALLOWED.size} allowed)`,
    offenders.length === 0,
    offenders.slice(0, 8).join('; '),
  );
}

console.log('\n— the email copy has two halves too');
{
  /*
    Nothing was scanning this.

    Email copy is deliberately not in messages/*.json — next-intl ships the
    bundle to every browser, and twenty templates of strings only the mail
    server reads would be paid for by every visitor. The cost of keeping it
    out is that all four checks above stop at the door: `emailCopy` is a plain
    object, ar and en are written by hand side by side, and a key added to one
    and not the other is a template that renders `undefined` as its heading
    for exactly the locale nobody tested in.

    Found the concrete version of this while giving followed companies their
    own digest wording, alongside a `labelSearch` that had been in both
    locales and read by nothing since the digest was written.

    Shape as well as keys: a string where the other locale has a function is
    the same bug arriving as `t.subject is not a function`.
  */
  const { emailCopy } = await import('../src/lib/email/copy.ts');

  const shape = (value, prefix = '') => {
    if (typeof value === 'function') return [[prefix, `fn/${value.length}`]];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value).flatMap(([key, inner]) =>
        shape(inner, prefix ? `${prefix}.${key}` : key),
      );
    }
    return [[prefix, typeof value]];
  };

  const ar = new Map(shape(emailCopy.ar));
  const en = new Map(shape(emailCopy.en));

  const missingEn = [...ar.keys()].filter((key) => !en.has(key));
  const missingAr = [...en.keys()].filter((key) => !ar.has(key));
  const mismatched = [...ar.entries()]
    .filter(([key, kind]) => en.has(key) && en.get(key) !== kind)
    .map(([key, kind]) => `${key} (ar ${kind}, en ${en.get(key)})`);

  check(`ar and en hold the same email keys (${ar.size})`,
    missingEn.length === 0 && missingAr.length === 0,
    [...missingEn.map((k) => `en missing ${k}`), ...missingAr.map((k) => `ar missing ${k}`)]
      .slice(0, 8)
      .join('; '));

  check('and the same shape at every key', mismatched.length === 0, mismatched.slice(0, 8).join('; '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
