/**
 * Title and description lengths, and the Arabic copy that has to land in them.
 *
 *   node --experimental-strip-types scripts/seo-meta.test.mjs   (in pnpm test:seo)
 */
import { readFileSync } from 'node:fs';
import { fitDescription, fitTitle, titleRoom, withOpenings } from '../src/lib/seo/meta-text.ts';
import { buildCompanySlug, buildJobSlug, slugify, slugifyEnglish } from '../src/lib/slug.ts';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
}

console.log('— fitting');
check('a short title is left alone', fitTitle('وظائف إداريين') === 'وظائف إداريين');
check('a long title breaks on a space', fitTitle('واحد اثنان ثلاثة اربعة خمسة', 12) === 'واحد اثنان');
check('a long description is cut to 155', fitDescription('ا'.repeat(200)).length <= 155);
check(
  'a count lead stays first and within 155',
  (() => {
    const out = withOpenings('2708 وظيفة متاحة الآن.', 'و'.repeat(200));
    return out.length <= 155 && out.startsWith('2708 وظيفة متاحة الآن.');
  })(),
);
check(
  'a short description grows with the pad, then stays within 155',
  (() => {
    const short = 'و'.repeat(90);
    const out = fitDescription(short, 'الراتب والعمولة ومصدر العملاء ظاهران قبل التقديم.');
    return out.length >= 120 && out.length <= 155 && out.startsWith(short);
  })(),
);

console.log('— English slugs, not transliteration');
check('Arabic is not transliterated into a slug', slugifyEnglish('وظائف أدمن') === '');
check('the old helper still transliterates', slugify('وظائف').startsWith('w'));
check('a Latin title is kept', slugifyEnglish('Property Consultant') === 'property-consultant');
check('an empty job title becomes role-', buildJobSlug('', 'new-cairo').startsWith('role-new-cairo-'));
check('an Arabic company name becomes company-', buildCompanySlug('شركة النيل').startsWith('company-'));
check('an English company name is kept', buildCompanySlug('Nile Brokers').startsWith('nile-brokers-'));

console.log('— the Arabic catalogue');
const meta = JSON.parse(readFileSync('messages/ar.json', 'utf8')).meta;
const descriptions = [
  'homeDescription',
  'jobsDescription',
  'signInDescription',
  'signUpDescription',
  'companiesDescription',
  'employersDescription',
  'privacyDescription',
  'termsDescription',
  'cookiesDescription',
  'refundsDescription',
  'accountDeletionDescription',
];
for (const key of descriptions) {
  const n = (meta[key] ?? '').length;
  check(`${key} is 120–155 characters`, n >= 120 && n <= 155, String(n));
}
const titles = [
  'jobsTitle',
  'signInTitle',
  'signUpTitle',
  'companiesTitle',
  'employersTitle',
  'privacyTitle',
  'termsTitle',
  'cookiesTitle',
  'refundsTitle',
  'accountDeletionTitle',
];
check(
  'homeTitle is the Arabic result title, at most 60 characters',
  meta.homeTitle === 'بروكرز كونكت | وظائف المبيعات العقارية في مصر' && meta.homeTitle.length <= 60,
  `${meta.homeTitle?.length} ${meta.homeTitle}`,
);
for (const key of titles) {
  const n = (meta[key] ?? '').length;
  check(`${key} is 50–60 characters`, n >= 50 && n <= 60, String(n));
}
check('back office is إداريين', JSON.parse(readFileSync('messages/ar.json', 'utf8')).track.back_office === 'إداريين');

console.log('— landing and company titles fill a result');
{
  const ar = JSON.parse(readFileSync('messages/ar.json', 'utf8'));
  const en = JSON.parse(readFileSync('messages/en.json', 'utf8'));
  function documentTitle(template, values, siteName) {
    const text = template.replace(/\{(\w+)\}/g, (_, key) => values[key]);
    return `${fitTitle(text, titleRoom(siteName))} | ${siteName}`;
  }
  const cases = [
    ['a short landing', ar.landing.metaTitle, { track: 'ريسيل', district: 'بدر' }, ar.meta.siteName],
    ['a long landing', ar.landing.metaTitle, { track: 'إداريين', district: 'التجمع الخامس' }, ar.meta.siteName],
    ['a short company', ar.companies.pageTitle, { name: 'هدى', place: 'مصر', kind: 'شركة عقارات' }, ar.meta.siteName],
    ['a named company', ar.companies.pageTitle, { name: 'النيل', place: 'مصر', kind: 'شركة وساطة عقارية' }, ar.meta.siteName],
    ['an English company', en.companies.pageTitle, { name: 'Nile', place: 'Egypt', kind: 'a brokerage' }, en.meta.siteName],
  ];
  for (const [label, template, values, site] of cases) {
    const title = documentTitle(template, values, site);
    check(`${label} is 50–60 characters`, title.length >= 50 && title.length <= 60, `${title.length} ${title}`);
  }
  check('the landing title does not say شاغر', !/شاغر|شواغر|عدد الأماكن/.test(ar.landing.metaTitle));
  const layout = readFileSync('src/app/[locale]/layout.tsx', 'utf8');
  check('metadataBase is the site url', layout.includes('metadataBase: new URL(env.siteUrl)'));
  const sitemap = readFileSync('src/app/sitemap.ts', 'utf8');
  check('sitemap lastmod is a constant', sitemap.includes('CATALOGUE_LASTMOD') && !sitemap.includes('statSync'));
  check(
    'company and landing titles leave room for the brand',
    readFileSync('src/app/[locale]/(site)/companies/[slug]/page.tsx', 'utf8').includes('titleRoom(') &&
      readFileSync('src/app/[locale]/(site)/jobs/[slug]/page.tsx', 'utf8').includes('titleRoom('),
  );
}

console.log('— job card marks stay on the client');
{
  const card = readFileSync('src/components/jobs/job-card.tsx', 'utf8');
  const marks = readFileSync('src/components/jobs/job-card-marks.tsx', 'utf8');
  check('the server card does not call useJobMarks', !card.includes('useJobMarks'));
  check('the server card is not a client module', !card.includes("'use client'"));
  check('the marks child is a client module', marks.startsWith("'use client'"));
  check('the marks child reads useJobMarks', marks.includes('useJobMarks()'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
