/**
 * Arabic matching for the admin user guide.
 *
 *   node --experimental-strip-types scripts/help-search.test.mjs
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./route-parity-hooks.mjs', import.meta.url);

const { foldArabic, matchRanges, filterHelp } = await import('../src/lib/admin/help/search.ts');
const { HELP_SECTIONS } = await import('../src/lib/admin/help/content.ts');

let failed = 0;
function check(label, ok) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
  }
}

function localize(locale) {
  const pick = (value) => value[locale];
  return HELP_SECTIONS.map((section) => ({
    id: section.id,
    title: pick(section.title),
    lede: pick(section.lede),
    features: section.features.map((feature) => ({
      id: feature.id,
      title: pick(feature.title),
      summary: pick(feature.summary),
      href: feature.href,
      steps: (feature.steps ?? []).map(pick),
      fields: (feature.fields ?? []).map((field) => ({ label: pick(field.label), detail: pick(field.detail) })),
      statuses: (feature.statuses ?? []).map((status) => ({
        label: pick(status.label),
        detail: status.detail ? pick(status.detail) : undefined,
        tone: status.tone,
      })),
      tips: (feature.tips ?? []).map(pick),
    })),
  }));
}

check('alef forms fold together', foldArabic('أإآا') === 'اااا');
check('teh marbuta folds to heh', foldArabic('شركة') === foldArabic('شركه'));
check('alef maqsura folds to yeh', foldArabic('على') === foldArabic('علي'));
check('diacritics are ignored', foldArabic('يُرَاجِع') === foldArabic('يراجع'));
check('tatweel is ignored', foldArabic('إعـلان') === foldArabic('اعلان'));
check('latin case is ignored', foldArabic('Admin') === 'admin');

const ranges = matchRanges('مراجعة الإعلان', 'اعلان');
check(
  'a folded query highlights the original spelling',
  ranges.length === 1 && 'مراجعة الإعلان'.slice(ranges[0][0], ranges[0][1]) === 'إعلان',
);
const whole = matchRanges('مراجعة الإعلان', 'الإعلان');
check('the definite article is part of the match when it was typed', whole.length === 1 && 'مراجعة الإعلان'.slice(whole[0][0], whole[0][1]) === 'الإعلان');

const guide = localize('ar');
check('every section has a feature', guide.every((section) => section.features.length > 0));

const ids = guide.flatMap((section) => [section.id, ...section.features.map((feature) => feature.id)]);
check('anchors are unique', new Set(ids).size === ids.length);

const byAlef = filterHelp(guide, 'اعلان');
check('اعلان reaches the listings section', byAlef.some((section) => section.id === 'listings'));

const empty = filterHelp(guide, 'كلمةليستفيمكان');
check('an unknown word is an empty result', empty.length === 0);

const both = filterHelp(guide, 'توثيق شركة');
check('every word of a query must match somewhere in a kept section', both.length > 0);

const english = localize('en');
check('english guide localises', english[0].title.length > 0 && english[0].title !== guide[0].title);
check(
  'both languages fill every sentence',
  HELP_SECTIONS.every((section) => section.title.ar && section.title.en && section.lede.ar && section.lede.en) &&
    HELP_SECTIONS.every((section) =>
      section.features.every(
        (feature) =>
          feature.title.ar &&
          feature.title.en &&
          feature.summary.ar &&
          feature.summary.en &&
          (feature.steps ?? []).every((step) => step.ar && step.en) &&
          (feature.fields ?? []).every((field) => field.label.ar && field.label.en && field.detail.ar && field.detail.en) &&
          (feature.statuses ?? []).every((status) => status.label.ar && status.label.en) &&
          (feature.tips ?? []).every((tip) => tip.ar && tip.en),
      ),
    ),
);

assert.equal(failed, 0);
console.log(`\n${ids.length} anchors, ${guide.length} sections`);
