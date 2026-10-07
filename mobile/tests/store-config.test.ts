import { OPERATOR } from '@/lib/business';
import { DELETE_WORD_ANY_KEYBOARD } from '@/lib/delete-confirmation';
import { catalogues } from '~/i18n/provider';
import { ENGLISH_ENABLED } from '@/lib/locale';

/*
  The App Store listing (store.config.js), held to what App Store Connect
  accepts and to what the app and the website actually are. EAS's own check,
  `npx eas-cli@latest metadata:lint`, holds it to Apple's schema; this one
  runs with every app check and needs nothing installed.
*/

type Info = {
  title: string;
  subtitle?: string;
  description?: string;
  keywords?: string[];
  promoText?: string;
  marketingUrl?: string;
  supportUrl?: string;
  privacyPolicyUrl: string;
  privacyChoicesUrl?: string;
};
type Review = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  demoUsername?: string;
  demoPassword?: string;
  demoRequired?: boolean;
  notes?: string;
};
type StoreConfig = {
  configVersion: number;
  apple: {
    version?: string;
    copyright?: string;
    categories?: string[];
    info: Record<string, Info>;
    advisory?: Record<string, unknown>;
    review?: Review;
  };
};

// The tests' types are Jest's alone (tests/tsconfig.json), so the little of
// Node used here is typed where it is used.
declare const __dirname: string;
const { existsSync, readFileSync } = jest.requireActual<{
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf8') => string;
}>('fs');
const { join } = jest.requireActual<{ join: (...parts: string[]) => string }>('path');

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the file EAS loads, as EAS loads it.
const loaded = require('../store.config.js') as (() => StoreConfig) & {
  storeConfig: (env: Record<string, string | undefined>) => StoreConfig;
};
const listing = loaded.storeConfig({});
const SITE = 'https://www.brokersconnect.net';
const root = join(__dirname, '..', '..');

const REVIEW_ENV = {
  APP_REVIEW_CONTACT_FIRST_NAME: 'Mona',
  APP_REVIEW_CONTACT_LAST_NAME: 'Adel',
  APP_REVIEW_CONTACT_EMAIL: 'review-contact@example.com',
  APP_REVIEW_CONTACT_PHONE: '+20 100 000 0000',
  APP_REVIEW_CANDIDATE_EMAIL: 'candidate@example.com',
  APP_REVIEW_CANDIDATE_PASSWORD: 'candidate-password',
  APP_REVIEW_EMPLOYER_EMAIL: 'employer@example.com',
  APP_REVIEW_EMPLOYER_PASSWORD: 'employer-password',
};

describe('the App Store listing', () => {
  const locales = Object.entries(listing.apple.info);

  it('is what EAS Metadata reads', () => {
    const eas = JSON.parse(readFileSync(join(__dirname, '..', 'eas.json'), 'utf8'));
    expect(eas.submit.production.ios.metadataPath).toBe('./store.config.js');
    // The App Store Connect record a first `eas submit` creates is Arabic first.
    expect(eas.submit.production.ios.language).toBe('ar-SA');
    expect(listing.configVersion).toBe(0);
    expect(loaded()).toEqual(loaded.storeConfig(process.env));
    expect(locales.map(([locale]) => locale).sort()).toEqual(['ar-SA', 'en-US']);
  });

  it.each(locales)('%s fits within what App Store Connect accepts', (_locale, info) => {
    expect(info.title.length).toBeGreaterThanOrEqual(2);
    expect(info.title.length).toBeLessThanOrEqual(30);
    expect((info.subtitle ?? '').length).toBeLessThanOrEqual(30);
    expect((info.description ?? '').length).toBeGreaterThanOrEqual(10);
    expect((info.description ?? '').length).toBeLessThanOrEqual(4000);
    expect((info.promoText ?? '').length).toBeLessThanOrEqual(170);

    // Apple counts the keywords joined by commas, 100 bytes at most: an
    // Arabic letter is two bytes of UTF-8, so a list of 92 characters was 170.
    const keywords = info.keywords ?? [];
    expect(new TextEncoder().encode(keywords.join(',')).length).toBeLessThanOrEqual(100);
    expect(new Set(keywords).size).toBe(keywords.length);
    for (const keyword of keywords) {
      expect(keyword).toBe(keyword.trim());
      expect(keyword).not.toContain(',');
    }

    // A listing that calls the app unfinished is turned down (Guideline 2.2).
    for (const words of [info.title, info.subtitle, info.description, ...keywords]) {
      expect((words ?? '').toLowerCase()).not.toMatch(/\bbeta\b|تجريبي/);
    }
  });

  it.each(locales)('%s links to pages the website has', (_locale, info) => {
    const urls = [info.marketingUrl, info.supportUrl, info.privacyPolicyUrl, info.privacyChoicesUrl];
    for (const url of urls) {
      expect(url).toBeDefined();
      expect((url as string).length).toBeLessThanOrEqual(255);
      const parsed = new URL(url as string);
      expect(parsed.origin).toBe(SITE);
      if (parsed.pathname === '/') continue;
      // A page of the site's own: its route, and the document it serves.
      const slug = parsed.pathname.slice(1);
      expect(existsSync(join(root, 'src', 'app', '[locale]', '(site)', slug, 'page.tsx'))).toBe(true);
      const lang = parsed.searchParams.get('lang') ?? 'ar';
      expect(existsSync(join(root, 'content', 'legal', `${slug}.${lang}.md`))).toBe(true);
    }
  });

  it("is for the version the build carries, which App Store Connect matches builds to", () => {
    const appConfig = readFileSync(join(__dirname, '..', 'app.config.ts'), 'utf8');
    const built = appConfig.match(/^\s*version: '([^']+)',$/m)?.[1];
    expect(built).toMatch(/^\d+\.\d+\.\d+$/);
    expect(listing.apple.version).toBe(built);
  });

  it('builds with the Node and pnpm the checks run on', () => {
    const eas = JSON.parse(readFileSync(join(__dirname, '..', 'eas.json'), 'utf8'));
    // Node from the repository's .nvmrc (a major), pnpm 10, as CI installs
    // them: pnpm 10 is what reads this project's settings from
    // pnpm-workspace.yaml (nodeLinker: hoisted); an older one ignores them.
    const major = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
    expect(eas.build.base.node.split('.')[0]).toBe(major);
    expect(eas.build.base.pnpm.split('.')[0]).toBe('10');
  });

  it('says the same things in both languages', () => {
    const [ar, en] = [listing.apple.info['ar-SA'], listing.apple.info['en-US']];
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    const bullets = (text: string | undefined) => (text ?? '').split('\n').filter((line) => line.startsWith('•')).length;
    expect(bullets(ar.description)).toBe(bullets(en.description));
  });

  it('says the app is in Arabic exactly while the website has no English', () => {
    const says = (listing.apple.info['en-US'].description ?? '').includes('The app is in Arabic.');
    expect(says).toBe(!ENGLISH_ENABLED);
  });

  it('names the operator the legal documents name', () => {
    expect(listing.apple.copyright).toMatch(/^\d{4} /);
    expect(listing.apple.copyright?.replace(/^\d{4} /, '')).toBe(OPERATOR.name);
  });

  it('answers every age-rating question, rated 18+', () => {
    const advisory = listing.apple.advisory ?? {};
    // The questions App Store Connect cannot do without (EAS's schema, metadata-0).
    for (const question of [
      'alcoholTobaccoOrDrugUseOrReferences',
      'contests',
      'gamblingSimulated',
      'horrorOrFearThemes',
      'matureOrSuggestiveThemes',
      'medicalOrTreatmentInformation',
      'profanityOrCrudeHumor',
      'sexualContentGraphicAndNudity',
      'sexualContentOrNudity',
      'violenceCartoonOrFantasy',
      'violenceRealistic',
      'violenceRealisticProlongedGraphicOrSadistic',
      'gambling',
      'unrestrictedWebAccess',
      'kidsAgeBand',
      'ageRatingOverride',
      'koreaAgeRatingOverride',
    ]) {
      expect(advisory).toHaveProperty(question);
    }
    expect(advisory.ageRatingOverrideV2).toBe('EIGHTEEN_PLUS');
    expect(advisory.userGeneratedContent).toBe(true);
    expect(listing.apple.categories).toEqual(['BUSINESS']);
  });
});

describe('the review details', () => {
  it('are left to App Store Connect when none is given', () => {
    expect(listing.apple.review).toBeUndefined();
    expect(JSON.stringify(listing)).not.toMatch(/password/i);
  });

  it('come from the environment, the employer account in the notes', () => {
    const review = loaded.storeConfig(REVIEW_ENV).apple.review;
    expect(review).toMatchObject({
      firstName: 'Mona',
      lastName: 'Adel',
      email: 'review-contact@example.com',
      phone: '+20 100 000 0000',
      demoUsername: 'candidate@example.com',
      demoPassword: 'candidate-password',
      demoRequired: true,
    });
    expect(review?.notes).toContain('employer@example.com / employer-password');
    expect((review?.notes ?? '').length).toBeLessThanOrEqual(4000);
  });

  it('lead App Review to the listing it applies to however far down the board it sits', () => {
    // The board puts the newest first, and a re-run of the review accounts keeps
    // the date the listings first went up: the company's page and a direct
    // link find it where browsing may not.
    const notes = loaded.storeConfig(REVIEW_ENV).apple.review?.notes ?? '';
    const sql = readFileSync(join(root, 'supabase', 'review-accounts.sql'), 'utf8');
    const slug = sql.match(/'(app-review-sales-manager)', 'resale'/)?.[1];
    expect(slug).toBeDefined();
    expect(notes).toContain(`https://www.brokersconnect.net/jobs/${slug}`);
    expect(notes).toContain('«مدير مبيعات (إعلان لمراجعة التطبيق)»');
    expect(sql).toContain("'مدير مبيعات (إعلان لمراجعة التطبيق)'");
    expect(notes).toContain('«حساب مراجعة التطبيق»');
    expect(sql).toContain("'حساب مراجعة التطبيق'");
  });

  it("name every control in the app's own Arabic words, and the ways App Review is asked about", () => {
    // App Review reads English and taps Arabic: each label quoted is one the
    // app shows (or a name the review accounts' SQL writes), so a reworded
    // label fails here instead of leaving a reviewer looking for it.
    const notes = loaded.storeConfig(REVIEW_ENV).apple.review?.notes ?? '';
    const sql = readFileSync(join(root, 'supabase', 'review-accounts.sql'), 'utf8');
    const shown = new Set<string>();
    (function collect(node: unknown) {
      if (typeof node === 'string') shown.add(node);
      else if (node && typeof node === 'object') Object.values(node).forEach(collect);
    })(catalogues.ar);
    const quoted = [...notes.matchAll(/«([^»]+)»/g)].map((match) => match[1]);
    expect(quoted.length).toBeGreaterThan(10);
    expect(quoted.filter((label) => !shown.has(label) && !sql.includes(`'${label}'`))).toEqual([]);

    const ar = catalogues.ar;
    // The companies directory, which a candidate reaches from Home: no tab of theirs is called that.
    expect(notes).toContain(`«${ar.nav.companies}»`);
    // Deleting: the word asked for, and the one an English keyboard can type; last, since it takes the applicant.
    expect(notes).toContain(`«${ar.account.deleteTitle}»`);
    expect(notes).toContain(`«${ar.account.deleteConfirmWord}», or the English word ${DELETE_WORD_ANY_KEYBOARD}`);
    expect(notes).toMatch(/try it last/);
    // User-generated content: report, hide and where hidden things come back.
    for (const label of [ar.jobs.report, ar.companies.report, ar.agents.report, ar.app.moderation.hide, ar.app.moderation.hideAgent, ar.app.moderation.hiddenList]) {
      expect(notes).toContain(`«${label}»`);
    }
    expect((notes ?? '').length).toBeLessThanOrEqual(4000);
  });

  it('are refused half given, naming what is missing', () => {
    const { APP_REVIEW_EMPLOYER_PASSWORD: _password, APP_REVIEW_CONTACT_PHONE: _phone, ...partial } = REVIEW_ENV;
    expect(() => loaded.storeConfig(partial)).toThrow(
      /missing APP_REVIEW_CONTACT_PHONE, APP_REVIEW_EMPLOYER_PASSWORD/,
    );
    expect(() => loaded.storeConfig({ ...REVIEW_ENV, APP_REVIEW_CANDIDATE_EMAIL: '  ' })).toThrow(
      /missing APP_REVIEW_CANDIDATE_EMAIL/,
    );
  });
});
