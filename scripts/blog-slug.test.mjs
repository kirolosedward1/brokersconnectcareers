/**
 * A blog slug from the URL reads a post and nothing else under content/.
 *
 *   node --experimental-strip-types --import ./scripts/email-harness/register.mjs scripts/blog-slug.test.mjs
 */
const { getPost, getPostSlugs } = await import('../src/lib/blog.ts');

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

const slugs = getPostSlugs();
check('the blog has posts to read', slugs.length > 0);
check('a post is read by its slug', Boolean(getPost(slugs[0], 'ar')));
for (const slug of ['../legal/privacy', '..%2Flegal%2Fprivacy', '../../package', '/etc/passwd', 'Post', '']) {
  check(`refused: ${JSON.stringify(slug)}`, getPost(slug, 'ar') === null && getPost(slug, 'en') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
