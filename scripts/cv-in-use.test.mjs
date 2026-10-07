/**
 * Which CVs the bytes check may delete when it refuses them.
 *
 *   node --experimental-strip-types scripts/cv-in-use.test.mjs
 *
 * The app attaches the profile's CV by default. A file stored before the check
 * existed, refused when it was sent again, was deleted — and the profile and
 * every application that carried it pointed at nothing. A file the caller's
 * rows already point at is kept; one just uploaded is not.
 */
const { cvInUse, releaseUnusedCv } = await import('../src/lib/cv-in-use.ts');

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

const ME = '44444444-0000-0000-0000-00000000000a';
const PROFILE_CV = `${ME}/cv-from-august.doc`;
const SENT_CV = `${ME}/cv-sent-in-may.pdf`;
const FRESH = `${ME}/just-uploaded.pdf`;

const ok = (data) => Promise.resolve({ data, error: null });
const broken = () => Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } });

/** A candidate with a profile CV and one application sent with another file. */
const reads = (change = {}) => ({
  profileCv: () => ok({ cv_path: PROFILE_CV }),
  applicationsWith: (path) => ok(path === SENT_CV ? [{ id: 'app-1' }] : []),
  ...change,
});

is("the profile's CV is in use", await cvInUse(reads(), PROFILE_CV), true);
is('a file an application went out with is in use', await cvInUse(reads(), SENT_CV), true);
is('a file just uploaded is not', await cvInUse(reads(), FRESH), false);
is('nor is any file, for somebody with no profile yet', await cvInUse(reads({ profileCv: () => ok(null) }), FRESH), false);
is('a profile read that failed keeps the file', await cvInUse(reads({ profileCv: broken }), FRESH), true);
is('so does an applications read that failed', await cvInUse(reads({ applicationsWith: broken }), FRESH), true);

console.log('\n— after a save that did not say ok');
{
  const removed = [];
  const remove = async (path) => removed.push(path);
  is('a file nothing points at is taken back out', await releaseUnusedCv(reads(), remove, FRESH), false);
  is('(and it was)', removed.join(','), FRESH);

  // The profile row went in with the new file, and the developer tags after it failed.
  const saved = reads({ profileCv: () => ok({ cv_path: FRESH }) });
  is('a file the saved profile now points at is kept', await releaseUnusedCv(saved, remove, FRESH), true);
  is('a file whose use could not be read is kept', await releaseUnusedCv(reads({ profileCv: broken }), remove, FRESH), true);
  is('(neither was removed)', removed.length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
