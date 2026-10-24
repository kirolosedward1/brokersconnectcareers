/**
 * The Google Play listing, in Arabic (the default language) and English: what
 * the Play Console's "Main store listing" asks for, typed in by hand there —
 * Play has no metadata file EAS pushes. The long descriptions are the App
 * Store's (store.config.js), so the two stores say the same thing.
 * scripts/release-check.mjs holds each field to Play's limits.
 *
 *   node store/play/listing.js      prints it, field by field, to paste
 *
 * docs/play-store.md has the rest of what the Play Console asks.
 */
const { storeConfig, descriptions } = require('../../store.config.js');

const apple = storeConfig({}).apple;

const listing = {
  defaultLanguage: 'ar',
  category: 'Business',
  contactEmail: 'info@topsuite.net',
  website: apple.info['ar-SA'].marketingUrl,
  privacyPolicyUrl: apple.info['ar-SA'].privacyPolicyUrl,
  accountDeletionUrl: apple.info['ar-SA'].privacyChoicesUrl,
  locales: {
    ar: {
      title: apple.info['ar-SA'].title,
      shortDescription: 'وظائف البيع والتسويق العقاري في مصر، بالراتب والعمولة ومصدر العملاء بوضوح.',
      fullDescription: descriptions.ar,
    },
    'en-US': {
      title: apple.info['en-US'].title,
      shortDescription: 'Real estate sales jobs in Egypt, with the salary, commission and lead source.',
      fullDescription: descriptions.en,
    },
  },
};

/** Play's limits, in characters. */
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };

module.exports = { listing, LIMITS };

if (require.main === module) {
  for (const key of ['defaultLanguage', 'category', 'contactEmail', 'website', 'privacyPolicyUrl', 'accountDeletionUrl']) {
    console.log(`${key}: ${listing[key]}`);
  }
  for (const [locale, fields] of Object.entries(listing.locales)) {
    for (const [field, text] of Object.entries(fields)) {
      console.log(`\n=== ${locale} · ${field} (${[...text].length}/${LIMITS[field]})\n${text}`);
    }
  }
}
