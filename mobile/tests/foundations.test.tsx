import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createTranslator } from 'use-intl';
import { JobCard } from '~/components/jobs/job-card';
import { CompanyLogo } from '~/components/companies/company-logo';
import { Avatar } from '~/components/ui/avatar';
import { Money } from '~/components/ui/money';
import { Num, numText } from '~/components/ui/num';
import { countMoved } from '~/features/applications/moved';
import { useMoney } from '~/features/money';
import { useCompensationText } from '~/features/jobs/compensation';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { LRI, PDI } from '~/i18n/rich';

const RLI = '\u2067';
import { SessionProvider } from '~/lib/session';
import { ThemeProvider } from '~/theme/provider';
import { listing } from './fixtures';
import { fakeServer } from './server';

/*
  The v1.1 foundations every screen is drawn with: one way to write a number
  (Num), one way to write money (useMoney, always with ج.م or EGP), the
  generic pictures for whoever has none, and the one listing card — and the
  rule that keeps digits out of Arabic sentences unless they are isolated.
*/

const mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

afterEach(() => {
  mockWindow.fontScale = 1;
});

// Node's own modules, required as tests/server.ts does: the app's typings have no Node in them.
/* eslint-disable @typescript-eslint/no-require-imports */
const { readdirSync, readFileSync, statSync } = require('node:fs') as {
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: 'utf8') => string;
  statSync: (path: string) => { isDirectory: () => boolean };
};
const { join, relative } = require('node:path') as { join: (...parts: string[]) => string; relative: (from: string, to: string) => string };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

const ar = catalogues.ar;
const translate = createTranslator({ locale: 'ar', messages: catalogues.ar });

function Providers({ children, locale }: { children: ReactNode; locale?: 'ar' | 'en' }) {
  return (
    <ThemeProvider>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </ThemeProvider>
  );
}

/** Western or Arabic-Indic digits (U+0660–0669, and the Persian forms U+06F0–06F9). */
const DIGIT = /[0-9٠-٩۰-۹]/;
/** An Arabic letter (hamza to yeh). */
const ARABIC_LETTER = /[ء-ي]/;

/**
 * What of a catalogue string is drawn as words: without its isolated runs
 * (<v>…</v>, or an isolate already in the text), its placeholders, and the
 * `=0` selectors of its plurals, which are syntax, not text.
 */
function words(text: string): string {
  return text
    .replace(/<v>[\s\S]*?<\/v>/g, '')
    .replace(new RegExp(`${LRI}[\\s\\S]*?${PDI}`, 'g'), '')
    .replace(/=\d+\s*\{/g, '{')
    .replace(/\{[A-Za-z_]\w*\}/g, '');
}

function strings(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => strings(child, prefix ? `${prefix}.${key}` : key));
}

describe('a digit in Arabic', () => {
  it("is never loose in the app's own Arabic strings: every number is a placeholder or isolated", () => {
    const loose = strings(ar.app, 'app').filter(([, text]) => DIGIT.test(words(text)));
    expect(loose.map(([key, text]) => `${key}: ${text}`)).toEqual([]);
  });

  it('is never written into Arabic in the code: Arabic words come from the catalogue', () => {
    const SRC = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(SRC);
    const found: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const code = line.trim();
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*') || code.startsWith('{/*')) return;
          // The words a line could put on the screen: its quoted strings and its JSX text, not its code (a regex, a slice(0)).
          const texts = [...code.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((match) => match[2]).concat([...code.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]));
          if (texts.some((text) => ARABIC_LETTER.test(text) && DIGIT.test(text))) found.push(`${relative(SRC, file)}:${index + 1}`);
        });
    }
    expect(found).toEqual([]);
  });

  it('catches what it is for: a bare number, not a placeholder, a selector or an isolated one', () => {
    expect(DIGIT.test(words('آخر 7 أيام'))).toBe(true);
    expect(DIGIT.test(words('آخر ٧ أيام'))).toBe(true);
    expect(DIGIT.test(words('آخر <v>7</v> أيام'))).toBe(false);
    expect(DIGIT.test(words('{count, plural, =0 {لا شيء} other {<v>#</v> وظيفة}}'))).toBe(false);
    expect(DIGIT.test(words(`مثل ${LRI}2024-03${PDI}`))).toBe(false);
  });
});

describe('Num', () => {
  it('keeps a sign and a percent against the number, in Western digits', () => {
    expect(numText(18, 'ar', { signed: true, percent: true })).toBe('+18%');
    expect(numText(-3, 'ar')).toBe('−3');
    expect(numText(-3, 'en')).toBe('−3');
    expect(numText(0, 'ar', { signed: true })).toBe('0');
    expect(numText(12500, 'ar')).toBe('12,500');
    // Marks Arabic formatting leaves round a figure are taken out: the run is isolated already.
    expect(numText('‏10 / 20؜', 'ar')).toBe('10 / 20');
  });

  it('draws the number isolated left to right, in tabular figures, from the start of the line', () => {
    render(
      <Providers>
        <Num value={-3} testID="num" />
      </Providers>,
    );
    const drawn = screen.getByTestId('num');
    expect(drawn.props.children).toBe(`${LRI}−3${PDI}`);
    expect(StyleSheet.flatten(drawn.props.style)).toEqual(
      expect.objectContaining({ writingDirection: 'ltr', fontVariant: ['tabular-nums'], textAlign: 'right' }),
    );
  });
});

describe('money', () => {
  function Amounts() {
    const money = useMoney();
    const pay = useCompensationText();
    return (
      <>
        {[
          money.amount(12000),
          money.pay(12000, 18000),
          money.pay(12000, null),
          money.pay(null, 18000),
          money.pay(null, null),
          money.perMonth,
          pay.salary(listing).amount,
          pay.salary({ ...listing, basic_salary_min: null, basic_salary_max: null }).figures,
        ].map((text, index) => (
          <Num key={index} value={text ?? 'none'} testID={`amount-${index}`} />
        ))}
      </>
    );
  }
  const shown = (index: number) => (screen.getByTestId(`amount-${index}`).props.children as string).slice(1, -1);

  it('always carries ج.م in Arabic, a range right to left with the smaller number first', () => {
    render(
      <Providers>
        <Amounts />
      </Providers>,
    );
    expect(shown(0)).toBe(`${LRI}12,000${PDI} ج.م`);
    expect(shown(1)).toBe(`${RLI}${LRI}12,000${PDI} – ${LRI}18,000${PDI} ج.م${PDI}`);
    expect(shown(2)).toBe(`من ${LRI}12,000${PDI} ج.م`);
    expect(shown(3)).toBe(`حتى ${LRI}18,000${PDI} ج.م`);
    expect(shown(4)).toBe('none');
    expect(shown(5)).toBe('ج.م / شهر');
    expect(shown(6)).toBe(`${RLI}${LRI}10,000${PDI} – ${LRI}15,000${PDI} ج.م${PDI}`);
    expect(shown(7)).toBe(ar.compensation.commissionOnly);
  });

  it('carries EGP in English', () => {
    render(
      <Providers locale="en">
        <Amounts />
      </Providers>,
    );
    expect(shown(0)).toBe(`${LRI}12,000${PDI} EGP`);
    expect(shown(2)).toBe(`From ${LRI}12,000${PDI} EGP`);
    expect(shown(5)).toBe('EGP / month');
  });

  it('draws an amount on its own line with its currency, read as one', () => {
    render(
      <Providers>
        <Money value={2500000} testID="money" />
      </Providers>,
    );
    expect(screen.getByTestId('money').props.accessibilityLabel).toBe(`${LRI}2,500,000${PDI} ج.م`);
    expect(screen.getByText(' ج.م')).toBeTruthy();
  });
});

describe('whoever has no picture', () => {
  const drawn = { includeHiddenElements: true };

  it('is the generic person, never their initial', () => {
    render(
      <Providers>
        <Avatar name="سارة" />
      </Providers>,
    );
    expect(screen.getByTestId('person-silhouette', drawn)).toBeTruthy();
    expect(screen.queryByText('س', drawn)).toBeNull();
  });

  it('is the generic building for a company without a logo', () => {
    render(
      <Providers>
        <CompanyLogo name="نايل بروكرز" />
      </Providers>,
    );
    expect(screen.getByTestId('building-silhouette', drawn)).toBeTruthy();
    expect(screen.queryByText('ن', drawn)).toBeNull();
  });
});

describe('the Applications badge', () => {
  const at = (id: string, status: 'new' | 'shortlisted' | 'interview' | 'hired' | 'rejected' | 'withdrawn') => ({ id, status });

  it('counts only a stage that changed since the screen was last seen', () => {
    // Never seen on this phone: nothing, however far along they are.
    expect(countMoved([at('a', 'hired')], null)).toBe(0);
    const seen = { a: 'new', b: 'shortlisted', c: 'new' } as const;
    expect(countMoved([at('a', 'new'), at('b', 'shortlisted'), at('c', 'new')], seen)).toBe(0);
    expect(countMoved([at('a', 'interview'), at('b', 'shortlisted'), at('c', 'rejected')], seen)).toBe(2);
    // Their own withdrawal is not news.
    expect(countMoved([at('a', 'withdrawn')], seen)).toBe(0);
    // Made since, and already moved: news. Made since and still new: not.
    expect(countMoved([at('d', 'shortlisted'), at('e', 'new')], seen)).toBe(1);
  });
});

describe('the listing card', () => {
  const server = fakeServer();
  beforeAll(() => {
    globalThis.fetch = server.fetch as unknown as typeof fetch;
  });

  function cardApp(applied: boolean) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return {
      _layout: () => (
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <I18nProvider>
              <SessionProvider>
                <Stack screenOptions={{ headerShown: false }} />
              </SessionProvider>
            </I18nProvider>
          </ThemeProvider>
        </QueryClientProvider>
      ),
      index: () => <JobCard job={{ ...listing, published_at: '2026-10-29T08:00:00Z' }} applied={applied} />,
    };
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-29T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the basic salary with ج.م / شهر, the facts as chips, and «قدّمت» — never the commission', async () => {
    await renderRouter(cardApp(true), { initialUrl: '/' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.getByText(`${RLI}${LRI}10,000${PDI} – ${LRI}15,000${PDI}${PDI}`)).toBeTruthy();
    expect(screen.getByText(` ${ar.app.money.perMonth}`)).toBeTruthy();
    for (const chip of [ar.leadsSource.company_provided_short, ar.track.primary, ar.app.jobs.appliedChip]) {
      expect(screen.getByText(chip)).toBeTruthy();
    }
    // Three seats: said to VoiceOver, no chip of their own (two chips on the card, owner's call, 31 Oct).
    expect(screen.queryByText(`3 ${translate('jobs.seatsLabel', { count: 3 })}`)).toBeNull();
    expect(screen.getByLabelText(new RegExp(`3 ${translate('jobs.seatsLabel', { count: 3 })}`))).toBeTruthy();
    expect(screen.queryByText(ar.experienceBand.junior_1_3)).toBeNull();
    expect(screen.queryByText(/1\.5/)).toBeNull();
    expect(screen.queryByText(new RegExp(ar.compensation.commission))).toBeNull();
    // The company's name never wraps: one line, cut with an ellipsis.
    const name = screen.getByText(listing.company.name_ar);
    expect(name.props.numberOfLines).toBe(1);
    expect(name.props.ellipsizeMode).toBe('tail');
  });

  it('puts «قدّمت» where the bookmark was, and marks a sponsored listing with its tab', async () => {
    const app = cardApp(true);
    app.index = () => <JobCard job={{ ...listing, is_featured: true, published_at: '2026-10-29T08:00:00Z' }} applied />;
    await renderRouter(app, { initialUrl: '/' });
    expect(await screen.findByText(ar.app.jobs.appliedChip)).toBeTruthy();
    expect(screen.getByText(ar.jobs.featured)).toBeTruthy();
    // The figures in the pay size and the primary ink.
    const figures = screen.getByText(`${RLI}${LRI}10,000${PDI} – ${LRI}15,000${PDI}${PDI}`);
    // A size under what it was: tighter cards (owner's call, 31 Oct).
    expect(StyleSheet.flatten(figures.props.style)).toEqual(expect.objectContaining({ fontSize: 20, lineHeight: 29 }));
  });

  it('says the experience asked to VoiceOver when there is a single seat, without a chip for it', async () => {
    const app = cardApp(false);
    app.index = () => <JobCard job={{ ...listing, seats: 1, published_at: '2026-10-29T08:00:00Z' }} />;
    await renderRouter(app, { initialUrl: '/' });
    // Two chips on the card (owner's call, 31 Oct); the years are still said, right to left.
    expect(await screen.findByLabelText(new RegExp(`${RLI}${ar.experienceBand.junior_1_3}${PDI}`))).toBeTruthy();
    expect(screen.queryByText(`${RLI}${ar.experienceBand.junior_1_3}${PDI}`)).toBeNull();
    expect(screen.queryByText(ar.app.jobs.appliedChip)).toBeNull();
  });

  it('is drawn right to left in Arabic (snapshot)', async () => {
    await renderRouter(cardApp(true), { initialUrl: '/' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    expect(screen.toJSON()).toMatchSnapshot();
  });

  it('is drawn whole at the largest accessibility text size (snapshot)', async () => {
    mockWindow.fontScale = 3.571;
    await renderRouter(cardApp(true), { initialUrl: '/' });
    expect(await screen.findByText(listing.title_ar)).toBeTruthy();
    // Nothing cut short but the company's name, which takes two lines there.
    expect(screen.getByText(listing.title_ar).props.numberOfLines).toBeUndefined();
    expect(screen.getByText(listing.company.name_ar).props.numberOfLines).toBe(2);
    expect(screen.toJSON()).toMatchSnapshot();
  });
});

