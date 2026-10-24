/**
 * Title and description lengths, and the Arabic copy that has to land in them.
 *
 *   node --experimental-strip-types scripts/seo-meta.test.mjs   (in pnpm test:seo)
 */
import { readFileSync } from 'node:fs';
import { fitDescription, fitTitle } from '../src/lib/seo/meta-text.ts';
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
  'privacyTitle',
  'termsTitle',
  'cookiesTitle',
  'refundsTitle',
  'accountDeletionTitle',
];
for (const key of titles) {
  const n = (meta[key] ?? '').length;
  check(`${key} is 50–60 characters`, n >= 50 && n <= 60, String(n));
}
check('back office is إداريين', JSON.parse(readFileSync('messages/ar.json', 'utf8')).track.back_office === 'إداريين');

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
