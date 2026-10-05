import { catalogues } from '~/i18n/provider';

// Node's own modules, required as tests/server.ts does: the app's typings have no Node in them.
/* eslint-disable @typescript-eslint/no-require-imports */
const { readdirSync, readFileSync } = require('node:fs') as {
  readdirSync: (dir: string) => string[];
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };
declare const __dirname: string;
// Its Node build by path: Jest's React Native resolver takes the package's browser one, an ES module.
const { parseAllDocuments } = require(join(__dirname, '..', 'node_modules', 'yaml', 'dist', 'index.js')) as {
  parseAllDocuments: (source: string) => { toJS: () => unknown }[];
};
/* eslint-enable @typescript-eslint/no-require-imports */

/*
  The iOS run (scripts/store-screens.sh, by hand on a Mac runner) finds each
  screen by its Arabic words. A phrase a flow waits for that the catalogue no
  longer says fails that run forty minutes in, long after the change that
  reworded it. So every phrase in maestro/*.yaml is tied here to the key its
  screen draws, and held to that key's text as Maestro matches it: rewording
  the key fails this test, whatever other key happens to say the same words.
  A phrase built from what the live site supplies (${JOB_TITLE}) is the
  site's, iOS's own question before opening a link is the system's, and what
  Expo Go asks the first time it opens the app (expo-go-alerts.yaml) is Expo
  Go's.
*/

/** The key each phrase is the text of, on the screen the flow looks for it on. */
const KEYS: Record<string, string> = {
  // checks.yaml: the states no screen may be showing.
  'في حاجة غلط': 'common.error',
  'مفيش اتصال بالإنترنت': 'app.offline.title',
  'الخدمة مش متاحة دلوقتي': 'app.unavailable.title',
  'الصفحة مش موجودة': 'common.notFound',
  'في نسخة أحدث من التطبيق': 'app.update.title',
  // Home, the tabs and the appearance switch.
  'منصة متخصصة لوظائف العقارات في مصر': 'landingPage.hero.title',
  'الرئيسية': 'app.tabs.home',
  'حسابي': 'app.tabs.account',
  'غامق': 'theme.dark',
  // The board, a listing, the companies.
  'الفلاتر.*': 'jobs.filters',
  'مفيش وظائف مطابقة لبحثك.': 'jobs.empty',
  'مشاركة': 'jobs.share',
  'الشركات اللي بتوظّف على بروكرز كونكت، والموثّق منها.': 'companies.lede',
  'مفيش شركات مطابقة.': 'companies.empty',
  // signed-out.yaml: Account's card, its sign-in button, the sheet, the forgotten password, sign-up.
  'ادخل على حسابك': 'app.account.signedOutTitle',
  'تسجيل الدخول': 'nav.signIn',
  'أهلاً بيك تاني': 'auth.signInTitle',
  'نسيت كلمة المرور؟': 'auth.forgotPassword',
  'اكتب إيميلك وهنبعتلك لينك تعمل بيه كلمة مرور جديدة.': 'auth.forgotBody',
  'اعمل حسابك': 'auth.signUpTitle',
  'تأكيد كلمة المرور': 'auth.passwordConfirm',
};

const FLOWS = join(__dirname, '..', 'maestro');
const SYSTEM = new Set(['فتح|Open', 'Continue', 'Allow']);
/**
 * Where a flow names text to find on screen: a command's own value, a
 * selector's `text`, and the selectors placed relative to another.
 */
const TEXT_KEYS = new Set([
  'tapOn',
  'doubleTapOn',
  'longPressOn',
  'assertVisible',
  'assertNotVisible',
  'copyTextFrom',
  'visible',
  'notVisible',
  'element',
  'text',
  'below',
  'above',
  'leftOf',
  'rightOf',
  'childOf',
  'containsChild',
  'containsDescendants',
]);
/**
 * Strings that are no text on screen: a command with no argument (under no
 * key), the app, a flow's name, a file run, a link opened, a screenshot's
 * name, a condition. Any other key holding a string fails the test below, so
 * a new way of naming text is sorted into one list or the other.
 */
const OTHER_KEYS = new Set(['', 'appId', 'name', 'file', 'runFlow', 'openLink', 'takeScreenshot', 'true']);

/** The strings in a flow by the key they sit under; an item of a list sits under the list's key. */
function stringsIn(node: unknown, key: string, into: { key: string; value: string }[]): { key: string; value: string }[] {
  if (typeof node === 'string') {
    into.push({ key, value: node });
  } else if (Array.isArray(node)) {
    for (const item of node) stringsIn(item, key, into);
  } else if (node && typeof node === 'object') {
    for (const [child, value] of Object.entries(node)) stringsIn(value, child, into);
  }
  return into;
}

function textsIn(node: unknown): string[] {
  return stringsIn(node, '', [])
    .filter(({ key }) => TEXT_KEYS.has(key))
    .map(({ value }) => value);
}

/**
 * As Maestro matches a selector's text: a regular expression over the whole
 * text, ignoring case, with `.` matching a new line; one that does not compile
 * is taken as the literal text.
 */
function maestroMatches(phrase: string, text: string): boolean {
  let pattern: RegExp;
  try {
    pattern = new RegExp(`^(?:${phrase})$`, 'is');
  } catch {
    return phrase.toLowerCase() === text.toLowerCase();
  }
  return pattern.test(text) || phrase === text;
}

function textOf(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogues.ar);
}

const documents = readdirSync(FLOWS)
  .filter((name) => name.endsWith('.yaml'))
  .flatMap((flow) => parseAllDocuments(readFileSync(join(FLOWS, flow), 'utf8')).map((document) => ({ flow, document: document.toJS() })));

const phrases = documents
  .flatMap(({ flow, document }) => textsIn(document).map((phrase) => ({ flow, phrase })))
  .filter(({ phrase }) => !phrase.includes('${') && !SYSTEM.has(phrase));

describe('the iOS run’s flows', () => {
  it('wait for words, and find some', () => {
    expect(phrases.length).toBeGreaterThan(20);
    expect(phrases.map(({ flow }) => flow)).toEqual(expect.arrayContaining(['checks.yaml', 'signed-out.yaml']));
  });

  it.each(phrases)('$flow: “$phrase” is what its screen says', ({ phrase }) => {
    expect(KEYS[phrase]).toBeDefined();
    const text = textOf(KEYS[phrase]);
    expect(typeof text).toBe('string');
    expect(maestroMatches(phrase, text as string)).toBe(true);
  });

  it('knows every key a flow puts a string under, as text on screen or not', () => {
    const unknown = documents.flatMap(({ flow, document }) =>
      stringsIn(document, '', [])
        .filter(({ key }) => !TEXT_KEYS.has(key) && !OTHER_KEYS.has(key))
        .map(({ key, value }) => `${flow}: ${key}: ${value}`),
    );
    expect(unknown).toEqual([]);
  });

  it('names no key a flow no longer looks for', () => {
    const used = new Set(phrases.map(({ phrase }) => phrase));
    expect(Object.keys(KEYS).filter((phrase) => !used.has(phrase))).toEqual([]);
  });

  it('reads a phrase the way Maestro does, in every form a flow can give it', () => {
    // The whole text, in any case; a pattern Maestro cannot compile stands for its own words.
    expect(maestroMatches('الفلاتر.*', 'الفلاتر (2)')).toBe(true);
    expect(maestroMatches('Open', 'open')).toBe(true);
    expect(maestroMatches('ادخل', 'ادخل على حسابك')).toBe(false);
    expect(maestroMatches('+201001234567', '+201001234567')).toBe(true);
    // A selector's `text`, single quotes, a comment after the value.
    const forms = parseAllDocuments(
      "appId: x\n---\n- tapOn:\n    text: 'أهلاً'\n- assertVisible: \"بيك\" # a note\n- scrollUntilVisible:\n    element:\n      text: تاني\n",
    ).flatMap((document) => textsIn(document.toJS()));
    expect(forms).toEqual(['أهلاً', 'بيك', 'تاني']);
    // The other commands that find text, a selector placed by another, and a list of them.
    const more = parseAllDocuments(
      'appId: x\n---\n- longPressOn: واحد\n- doubleTapOn: اتنين\n- tapOn:\n    text: تلاتة\n    below: أربعة\n- assertVisible:\n    text: خمسة\n    childOf:\n      text: ستة\n    containsDescendants:\n      - سبعة\n      - text: تمانية\n',
    ).flatMap((document) => textsIn(document.toJS()));
    expect(more).toEqual(['واحد', 'اتنين', 'تلاتة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'تمانية']);
  });
});
