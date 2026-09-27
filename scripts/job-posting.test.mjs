/**
 * The JobPosting markup, checked against Google's rules for it.
 *
 *   node --experimental-strip-types scripts/job-posting.test.mjs
 *
 * Pure functions, no database. What this guards is the promise the markup
 * makes to Google: every property comes from a column, nothing is invented to
 * fill a gap, and a listing that is not open can never carry live markup.
 */
import {
  buildJobPosting,
  descriptionHtml,
  jobPostingProblems,
  REQUIRED,
} from '../src/lib/seo/job-posting-core.ts';

let pass = 0;
let fail = 0;

function is(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const NOW = new Date('2026-09-27T12:00:00Z');
const day = 86_400_000;

const base = {
  id: '6f1c2c1e-0000-4000-8000-000000000001',
  url: 'https://www.brokersconnect.net/jobs/property-consultant-new-cairo-123456',
  title: 'استشاري مبيعات عقارية',
  description: 'نبحث عن استشاري مبيعات.\n\nالعمل في التجمع الخامس.',
  requirements: 'خبرة سنة\nرخصة قيادة',
  publishedAt: new Date(NOW.getTime() - 3 * day).toISOString(),
  expiresAt: new Date(NOW.getTime() + 27 * day).toISOString(),
  employmentType: 'full_time',
  experienceBand: 'junior_1_3',
  seats: 3,
  salaryMin: 8000,
  salaryMax: 12000,
  company: { name: 'نايل بروكرز', website: 'https://nile.example', logoUrl: 'https://x.supabase.co/logo.png' },
  location: { locality: 'التجمع الخامس', region: 'القاهرة' },
};

const build = (overrides = {}) =>
  buildJobPosting({ ...base, ...overrides }, { now: NOW, requirementsHeading: 'المطلوب' });

console.log('— a complete listing produces valid markup');
const full = build();
is('builds', full !== null, true);
is('no problems', jobPostingProblems(full, NOW), []);
for (const key of REQUIRED) is(`has required ${key}`, full?.[key] != null && full?.[key] !== '', true);
is('type', full['@type'], 'JobPosting');
is('employment type maps to Google vocabulary', full.employmentType, 'FULL_TIME');
is('country is Egypt', full.jobLocation.address.addressCountry, 'EG');
is('region is the governorate', full.jobLocation.address.addressRegion, 'القاهرة');
is('locality is the district', full.jobLocation.address.addressLocality, 'التجمع الخامس');
is('salary range in EGP a month', full.baseSalary, {
  '@type': 'MonetaryAmount',
  currency: 'EGP',
  value: { '@type': 'QuantitativeValue', minValue: 8000, maxValue: 12000, unitText: 'MONTH' },
});
is('experience floor in months', full.experienceRequirements, {
  '@type': 'OccupationalExperienceRequirements',
  monthsOfExperience: 12,
});
is('seats become totalJobOpenings', full.totalJobOpenings, 3);
is('dates are ISO 8601', [full.datePosted, full.validThrough].every((d) => /^\d{4}-\d\d-\d\dT/.test(d)), true);
is('company site is sameAs', full.hiringOrganization.sameAs, 'https://nile.example/');
is('directApply is not claimed for a sign-up-gated flow', full.directApply, false);

console.log('\n— nothing is fabricated');
const commission = build({ salaryMin: null, salaryMax: null, employmentType: 'freelance_commission_only' });
is('commission-only has no baseSalary', 'baseSalary' in commission, false);
is('commission-only is CONTRACTOR', commission.employmentType, 'CONTRACTOR');
is('a zero salary is not a salary', 'baseSalary' in build({ salaryMin: 0, salaryMax: 0 }), false);
is('a floor alone is published as a floor', build({ salaryMax: null }).baseSalary.value, {
  '@type': 'QuantitativeValue',
  minValue: 8000,
  unitText: 'MONTH',
});
is('an exact salary is a single value', build({ salaryMin: 9000, salaryMax: 9000 }).baseSalary.value, {
  '@type': 'QuantitativeValue',
  value: 9000,
  unitText: 'MONTH',
});
is('unknown governorate is omitted, not guessed', 'addressRegion' in build({ location: { locality: 'الشيخ زايد', region: null } }).jobLocation.address, false);
const noSite = build({ company: { name: 'X', website: null, logoUrl: null } });
is('no website means no sameAs', 'sameAs' in noSite.hiringOrganization, false);
is('no logo means no logo', 'logo' in noSite.hiringOrganization, false);
is('a non-http website is dropped', 'sameAs' in build({ company: { name: 'X', website: 'javascript:alert(1)' } }).hiringOrganization, false);
is('one seat says nothing about openings', 'totalJobOpenings' in build({ seats: 1 }), false);
is('fresh graduates: "no requirements", not zero months', build({ experienceBand: 'fresh_0_1' }).experienceRequirements, 'no requirements');
is('no expiry means no validThrough', 'validThrough' in build({ expiresAt: null }), false);

console.log('\n— a listing that cannot be described honestly gets no markup');
is('expired by date', build({ expiresAt: new Date(NOW.getTime() - 1000).toISOString() }), null);
is('never published', build({ publishedAt: null }), null);
is('empty description', build({ description: '   ' }), null);
is('empty company name', build({ company: { name: '' } }), null);
is('empty district', build({ location: { locality: '', region: 'القاهرة' } }), null);
is('published in the future', build({ publishedAt: new Date(NOW.getTime() + 2 * day).toISOString() }), null);

console.log('\n— the description is the page, escaped');
is(
  'paragraphs, line breaks and requirements under their heading',
  descriptionHtml('a\n\nb\nc', 'r1\nr2', 'المطلوب'),
  '<p>a</p><p>b<br>c</p><p><strong>المطلوب</strong></p><p>r1<br>r2</p>',
);
is('employer text is escaped', descriptionHtml('5 < 6 & "ok"'), '<p>5 &lt; 6 &amp; "ok"</p>');
is('tags typed into a description are stripped, not rendered', descriptionHtml('<script>x</script>hi'), '<p>x hi</p>');
is('JSON-serialisable', JSON.parse(JSON.stringify(full)).title, base.title);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
