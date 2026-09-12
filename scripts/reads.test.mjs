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
 * Routes are in scope too, since the sweep reached them. They have no empty
 * state, but they have the same silence in a different costume: the sign-in
 * callback read a profile and treated a failure as "has not onboarded",
 * sending established accounts through the sign-up form — the exact confusion
 * `getViewer.profileUnreadable` exists to prevent, on the one path every
 * Google sign-in takes. The CV route answered a failed read with 404, which
 * tells an employer no CV was attached. And the delivery webhook assigned
 * `matched = data ?? 0` and returned 200, so a status that was never recorded
 * looked like one that was, and the provider stopped retrying.
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
    return /\/(page|layout)\.tsx$|\/route\.ts$/.test(full) ? [full] : [];
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

console.log('\n— no read in src/app drops its error');
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
    'every `{ data }` in a page or route reads its error, or says why not',
    offenders.length === 0,
    offenders.slice(0, 10).join('; '),
  );
}

/*
  And the other direction, so the marker cannot become a habit: it has to be
  rare. Twelve today: seven in pages, all cosmetic — two developer chip lists,
  two "applied" badges, two note-author lookups, one follow state — and five in
  routes, where the fallbacks are a digest in Arabic rather than English, an
  email that names no listings, and an admin check that fails closed. Fifteen
  leaves room for the next honest one and still notices a habit forming, at
  which point the question is not "raise or not" but why so many of these
  reads exist at all.
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
    `"allowed to fail quietly" appears ${markers.length} times, and fifteen is where it stops being a decision`,
    markers.length <= 15,
    markers.join('; '),
  );
}

/*
  The other half of the same habit: trusting the stored label.

  `status = 'active'` is a claim the nightly cron keeps true, and that cron
  needs a service-role key production does not have — so on the live site a
  listing whose window closed reads `active` indefinitely. One has since
  10 September. `jobIsLive()` and `displayJobStatus()` exist so nothing has to
  remember that, and every surface uses them except, until now, the candidate's
  own applications page: the note saying the listing had closed simply never
  appeared, leaving the person waiting on a reply as the only one still told it
  was open.

  So: a comparison against `'active'` in a component or page has to be either
  a filter in a query (which bounds `expires_at` right there) or routed
  through the helpers. Anything else names the label and means the date.
*/
console.log('\n— nothing trusts the active label on its own');
{
  const offenders = [];

  /*
    Every source file, not just pages: the third copy of this rule was in
    `job-card.tsx`, which `walk` above deliberately does not reach because the
    read check is about empty states.
  */
  const everything = [];
  (function collect(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) collect(full);
      else if (/\.tsx?$/.test(entry)) everything.push(full);
    }
  })(join(ROOT, 'src'));

  for (const file of everything) {
    // job-state.ts is where the rule lives; it has to name the label.
    if (file.endsWith('job-state.ts')) continue;

    const text = code(file);
    text.split('\n').forEach((line, index) => {
      // A comparison, not a query filter: `.eq('status', 'active')` is fine,
      // because the query beside it bounds the date.
      if (!/(?:status\s*[!=]==?\s*'active'|'active'\s*[!=]==?\s*\w*status)/.test(line)) return;
      if (/\.eq\(|\.in\(|filter\(/.test(line)) return;
      // The helpers are the sanctioned form, and admin queues legitimately
      // compare the stored label because that is the column they moderate.
      if (/jobIsLive|displayJobStatus/.test(line)) return;
      if (file.includes('/admin/')) return;

      /*
        And a stated exemption, for the three places where the label really is
        the question: two gate a *write* on whether the row is published,
        which a closed window does not change, and one receives a status its
        caller already ran through displayJobStatus.
      */
      const raw = readFileSync(file, 'utf8').split('\n');
      const above = raw.slice(Math.max(0, index - 5), index).join('\n');
      if (/the stored label, deliberately/i.test(above)) return;

      offenders.push(`${file.replace(ROOT + '/', '')}:${index + 1}`);
    });
  }

  check(
    'every status comparison outside the admin queues goes through job-state',
    offenders.length === 0,
    offenders.slice(0, 8).join('; '),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
