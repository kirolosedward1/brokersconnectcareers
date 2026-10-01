/**
 * The legal documents, and everything that has to agree with them.
 *
 *   node --experimental-strip-types scripts/legal.test.mjs   (pnpm test:legal)
 *
 * Nothing here reads the words for sense — a lawyer does that. What is pinned
 * is what breaks quietly: a document with no page or no English text, the two
 * texts of one document dated apart, a page the deployed function carries no
 * file for, a policy version that is not the date the document shows (so
 * nobody is asked to agree to the change), a footer that stops linking a
 * document, the operator's details dropping out of the documents that name
 * them, and something new kept in the browser that the cookie page does not
 * list.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATOR } from '../src/lib/business.ts';
import { POLICY_VERSIONS } from '../src/lib/policy-versions.ts';

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

const read = (path) => readFileSync(path, 'utf8');

/** `key: value` lines above a `---`, as lib/legal.ts reads them. */
function frontmatter(raw) {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return {};
  const data = {};
  for (const line of raw.slice(3, end).split('\n')) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    data[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
  }
  return data;
}

const legalSource = read('src/lib/legal.ts');
const slugList = legalSource.match(/LEGAL_SLUGS = \[([^\]]+)\] as const/);
const SLUGS = slugList ? [...slugList[1].matchAll(/'([\w-]+)'/g)].map((match) => match[1]) : [];

console.log('— the documents');
check('lib/legal.ts names its documents', SLUGS.length >= 5, SLUGS.join(', '));

const docs = {};
for (const slug of SLUGS) {
  docs[slug] = {};
  for (const lang of ['ar', 'en']) {
    const path = `content/legal/${slug}.${lang}.md`;
    const exists = existsSync(path);
    check(`${path} exists`, exists);
    if (!exists) continue;
    const raw = read(path);
    const data = frontmatter(raw);
    docs[slug][lang] = { raw, data, headings: raw.split('\n').filter((line) => line.startsWith('## ')).length };
    check(`${path} has a title`, Boolean(data.title));
    check(`${path} is dated YYYY-MM-DD`, /^\d{4}-\d{2}-\d{2}$/.test(data.updated ?? ''), data.updated);
    check(`${path} has no placeholder left in it`, !/\b(TODO|TBD|FIXME|XXX|lorem)\b|\{\{|\[\[/i.test(raw));
  }
  const { ar, en } = docs[slug];
  if (ar && en) {
    check(`${slug}: both texts carry the same date`, ar.data.updated === en.data.updated, `${ar.data.updated} / ${en.data.updated}`);
    check(`${slug}: both texts have the same sections`, ar.headings === en.headings, `${ar.headings} / ${en.headings}`);
  }
}

const unexpected = readdirSync('content/legal').filter((file) => !SLUGS.some((slug) => file === `${slug}.ar.md` || file === `${slug}.en.md`));
check('content/legal holds nothing lib/legal.ts does not serve', unexpected.length === 0, unexpected.join(', '));

console.log('— what a person agrees to');
for (const kind of ['terms', 'privacy']) {
  for (const lang of ['ar', 'en']) {
    const updated = docs[kind]?.[lang]?.data.updated;
    check(
      `${kind}.${lang}.md is the version people agree to (lib/policy-versions.ts)`,
      updated === POLICY_VERSIONS[kind],
      `the document says ${updated}, POLICY_VERSIONS.${kind} says ${POLICY_VERSIONS[kind]} — change both, which asks everybody to agree again`,
    );
  }
}

console.log('— who runs the site');
for (const slug of ['privacy', 'terms']) {
  for (const lang of ['ar', 'en']) {
    const raw = docs[slug]?.[lang]?.raw ?? '';
    check(`${slug}.${lang}.md names the operator`, raw.includes(OPERATOR.name));
    check(`${slug}.${lang}.md gives the operator's email`, raw.includes(OPERATOR.email));
    check(`${slug}.${lang}.md gives the operator's phone`, raw.includes(OPERATOR.phone));
  }
}
for (const slug of ['account-deletion', 'cookies', 'refunds']) {
  for (const lang of ['ar', 'en']) {
    check(`${slug}.${lang}.md says where to write`, (docs[slug]?.[lang]?.raw ?? '').includes(OPERATOR.email));
  }
}

console.log('— the documents point at each other');
for (const lang of ['ar', 'en']) {
  const privacy = docs.privacy?.[lang]?.raw ?? '';
  check(`privacy.${lang}.md links the cookie page`, privacy.includes('](/cookies)'));
  check(`privacy.${lang}.md links the account-deletion page`, privacy.includes('](/account-deletion)'));
  const terms = docs.terms?.[lang]?.raw ?? '';
  check(`terms.${lang}.md links the privacy policy`, terms.includes('](/privacy)'));
  check(`terms.${lang}.md links the refunds page`, terms.includes('](/refunds)'));
}

console.log('— every page, and the files its function carries');
const config = read('next.config.ts');
const include = config.match(/'\/\*\*\/\{([^}]+)\}': \['\.\/content\/legal\/\*\*\/\*'\]/);
const traced = include ? include[1].split(',') : [];
for (const slug of SLUGS) {
  const page = `src/app/[locale]/(site)/${slug}/page.tsx`;
  check(`/${slug} has a page`, existsSync(page) && read(page).includes(`legalPage('${slug}')`));
  check(`/${slug}'s function is built with content/legal (next.config.ts)`, traced.includes(slug), traced.join(','));
}

console.log('— reachable from every page and from the app');
const footer = read('src/components/site-footer.tsx');
for (const href of [...SLUGS.map((slug) => `/${slug}`), '/licenses']) {
  check(`the footer links ${href}`, footer.includes(`href: '${href}'`));
}
check('the footer says who runs the site', footer.includes("t('operatedBy', { name: OPERATOR.name })"));
check('the sitemap lists every document', read('src/app/sitemap.ts').includes('LEGAL_SLUGS.map('));
const account = read('mobile/src/app/(tabs)/(account)/account/index.tsx');
for (const target of ["openSitePage('/privacy')", "openSitePage('/terms')", "router.push('/account/licenses')", "t('footer.operatedBy'"]) {
  check(`the app's Account tab has ${target}`, account.includes(target));
}

console.log('— everything the website keeps in a browser is on the cookie page');
/**
 * The places the website writes to a browser's storage itself. A new one
 * fails here until it is listed on the cookie page and below. The session
 * cookies are Supabase's (@supabase/ssr, through lib/supabase/*), named
 * sb-<project>-auth-token.
 */
const KNOWN_WRITERS = {
  'src/components/theme-toggle.tsx': "THEME_STORAGE_KEY = 'bc-theme'",
  'src/lib/share-source.ts': "KEY = 'bc.src'",
};
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const writers = walk('src').filter((path) => /(localStorage|sessionStorage)\.setItem\(|document\.cookie\s*=/.test(read(path)));
const strays = writers.filter((path) => !(path in KNOWN_WRITERS));
check('nothing new writes to the browser', strays.length === 0, `${strays.join(', ')}: list what it keeps on content/legal/cookies.*.md, then here`);
for (const [path, declaration] of Object.entries(KNOWN_WRITERS)) {
  check(`${path} still keeps what the cookie page says`, read(path).includes(declaration), declaration);
}
for (const lang of ['ar', 'en']) {
  const cookies = docs.cookies?.[lang]?.raw ?? '';
  for (const name of ['sb-', 'bc-theme', 'bc.src']) {
    check(`cookies.${lang}.md lists ${name}`, cookies.includes(name));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
