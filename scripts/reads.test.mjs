/**
 * Reads that fail as "there is nothing here".
 *
 *   node scripts/reads.test.mjs
 *
 * Supabase hands back `{ data, error }` and never throws. So
 * `const { data } = await supabase.from(…)` compiles, passes review, and turns
 * every failure into `data: null` — which a page then renders as its empty
 * state. Twenty of those had accumulated across fourteen pages, and the
 * sentences they produced were: "you have not applied to any job" to somebody
 * with six applications, "nobody has applied" to a listing with five
 * applicants, "post your first listing" to a brokerage with four, and an admin
 * moderation queue reading empty — which is precisely the answer a reviewer
 * acts on by going away.
 *
 * Round 3 spent a prompt on mutations that fail in silence. This is the same
 * failure on the read, and it is worse in one way: a mutation that does nothing
 * leaves the screen unchanged, while a read that fails fills the screen with a
 * confident and false answer.
 *
 * So: every `{ data }` destructure in a page must either take `error` as well,
 * or say in a comment why it is allowed to fail quietly. Not every read has to
 * raise — a chip list, an "applied" badge, a note's author name are all worth
 * less than the page they sit on. What is not allowed is silence by omission.
 *
 * Scoped to `page.tsx` and `layout.tsx`, because the failure this is about is
 * an *empty state* — a screen that answers the reader's question wrongly. An
 * API route has no empty state: it returns a status, and a cron that reads
 * nothing does nothing, which is a different problem with different right
 * answers. Those are worth a sweep of their own and would only be diluted by
 * being counted here.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
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

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\/(page|layout)\.tsx$/.test(full) ? [full] : [];
  });
}

/**
 * Comments blanked rather than deleted, so the line numbers reported still
 * match the file — and so that a comment *about* this pattern, of which there
 * are now several, does not report itself as an instance of it.
 */
function code(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');
}

/** The marker that turns a silent read into a stated decision. */
const ALLOWED = /allowed to fail quietly/i;

/** How far above the destructure the marker may sit. */
const LOOKBACK = 4;

console.log('\n— no page read fails as an empty state');
{
  const offenders = [];

  for (const file of walk(join(ROOT, 'src', 'app'))) {
    const lines = code(file).split('\n');
    const raw = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      // A `{ data }` or `{ data: named }` destructure that does not also take
      // an error. `error:` covers the renamed form (`error: jobError`).
      if (!/const \{\s*data\b/.test(line)) return;
      if (/\berror\b/.test(line)) return;

      // The marker is in a comment, so look for it in the raw text.
      const context = raw.slice(Math.max(0, index - LOOKBACK), index).join('\n');
      if (ALLOWED.test(context)) return;

      offenders.push(`${file.replace(ROOT + '/', '')}:${index + 1}`);
    });
  }

  check(
    'every `{ data }` in src/app reads its error or says why not',
    offenders.length === 0,
    offenders.slice(0, 10).join('; '),
  );
}

/*
  And the other direction, so the marker cannot become a habit: it has to be
  rare. Seven today, all genuinely cosmetic: two developer chip lists, two
  "applied" badges, two note-author lookups and one follow state. Ten leaves
  room for the next honest one and still notices a habit forming — at which
  point the question is not "raise or not" but why so many pages have
  decorative reads in them.
*/
console.log('\n— and the exemption stays rare');
{
  const markers = walk(join(ROOT, 'src', 'app')).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => ALLOWED.test(line))
      .map(() => file.replace(ROOT + '/', '')),
  );

  check(
    `"allowed to fail quietly" appears ${markers.length} times, and ten is where it stops being a decision`,
    markers.length <= 10,
    markers.join('; '),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
