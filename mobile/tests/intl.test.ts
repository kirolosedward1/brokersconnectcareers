/**
 * The phone and the website must write every number, date and plural the same.
 *
 * The phone formats with the formatjs polyfills (src/lib/intl-polyfills.ts),
 * which every test here runs on (tests/setup.ts); the website with its engine's
 * own Intl, which the setup keeps aside as `nodeIntl`. The two once disagreed
 * about one formatter — src/lib/format.ts asked for Canadian English, which the
 * polyfills do not carry — and every job card threw on the phone while every
 * test passed in Node. So each shared formatter, and each message in the
 * catalogue that formats a number, a plural, a choice or a date, runs on both
 * and must come out the same.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each side needs its
   own copy of a module, loaded while that side's Intl is in place. */
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { catalogues } from '~/i18n/provider';

type Format = typeof import('@/lib/format');
type Core = typeof import('use-intl/core');

const SWAPPED = ['DateTimeFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat', 'Locale', 'getCanonicalLocales'] as const;
type Swapped = Pick<typeof Intl, (typeof SWAPPED)[number]>;

const phoneIntl = Object.fromEntries(SWAPPED.map((key) => [key, Intl[key]])) as Swapped;
const nodeIntl = (globalThis as { nodeIntl?: Swapped }).nodeIntl;

function swapIntl(source: Swapped) {
  for (const key of SWAPPED) {
    Object.defineProperty(Intl, key, { value: source[key], writable: true, configurable: true });
  }
}

/** Runs with the website's Intl in place of the phone's. */
function onTheWebsite<T>(run: () => T): T {
  swapIntl(nodeIntl as Swapped);
  try {
    return run();
  } finally {
    swapIntl(phoneIntl);
  }
}

/** A fresh copy of a module for each side, so no formatter made by one serves the other. */
function load<T>(id: string): { website: T; phone: T } {
  let website: T | undefined;
  let phone: T | undefined;
  onTheWebsite(() => jest.isolateModules(() => void (website = require(id) as T)));
  jest.isolateModules(() => void (phone = require(id) as T));
  return { website: website as T, phone: phone as T };
}

type Case = { label: string; website: () => unknown; phone: () => unknown };

function outcome(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    return `throws ${(error as Error).name}: ${(error as Error).message}`;
  }
}

/** The cases whose two sides disagree, each with both answers. */
function disagreements(cases: Case[]): string[] {
  return cases.flatMap(({ label, website, phone }) => {
    const onWeb = outcome(() => onTheWebsite(website));
    const onPhone = outcome(phone);
    return onWeb === onPhone ? [] : [`${label}\n  website: ${onWeb}\n  phone:   ${onPhone}`];
  });
}

it('keeps the website’s own Intl aside for the comparison', () => {
  expect(nodeIntl?.DateTimeFormat).toBeDefined();
  expect(nodeIntl?.DateTimeFormat).not.toBe(Intl.DateTimeFormat);
});

describe('the shared formatters', () => {
  const format = load<Format>('@/lib/format');
  const now = new Date('2026-09-29T09:00:00Z');

  const stamps = [
    '2026-08-31T12:48:30.464925+00:00', // as PostgREST sends a timestamptz
    '2026-08-31 12:48:30.464925+00', // as Postgres writes one in text
    '2026-09-28T22:30:00+00:00', // 01:30 on the 29th in Cairo, summer time
    '2026-01-15T22:30:00Z', // 00:30 on the 16th in Cairo, winter time
    '2026-04-23T22:30:00Z', // the night summer time begins
    '2026-10-29T21:30:00Z', // the night it ends
    '2026-12-31T21:59:00Z',
    '2026-09-29', // a date column
    'not a date',
  ];
  const ago = [
    '2026-09-29T06:00:00+00:00',
    '2026-09-28T10:00:00+00:00',
    '2026-09-28T21:30:00+00:00', // already the 29th in Cairo
    '2026-09-27T10:00:00+00:00',
    '2026-09-22T10:00:00+00:00',
    '2026-08-30T10:00:00+00:00', // 30 days
    '2026-08-29T10:00:00+00:00', // 31 days: the date instead
    '2026-09-30T10:00:00+00:00', // tomorrow: the date
    '2026-09-28 10:00:00+00',
    'not a date',
  ];
  const numbers = [0, 7, 1234, 1234567.5, -2500];

  it('write the same on the phone as on the website', () => {
    const cases: Case[] = [];
    for (const locale of ['ar', 'en']) {
      for (const n of numbers) {
        for (const fn of ['formatNumber', 'formatEgp'] as const) {
          cases.push({ label: `${fn}(${n}, ${locale})`, website: () => format.website[fn](n, locale), phone: () => format.phone[fn](n, locale) });
        }
      }
      for (const stamp of stamps) {
        for (const fn of ['formatDate', 'formatDayMonth'] as const) {
          cases.push({ label: `${fn}(${stamp}, ${locale})`, website: () => format.website[fn](stamp, locale), phone: () => format.phone[fn](stamp, locale) });
        }
      }
      for (const stamp of ago) {
        cases.push({
          label: `formatRelativeDay(${stamp}, ${locale})`,
          website: () => format.website.formatRelativeDay(stamp, locale, now),
          phone: () => format.phone.formatRelativeDay(stamp, locale, now),
        });
      }
    }
    expect(disagreements(cases)).toEqual([]);
  });

  it('never throw on a value that is not a date', () => {
    expect(format.phone.formatDate('not a date', 'ar')).toBe('');
    expect(format.phone.formatDayMonth('not a date', 'ar')).toBe('');
    expect(format.phone.formatRelativeDay('not a date', 'ar', now)).toBe('');
  });

  it('count days on Cairo’s calendar', () => {
    expect(format.phone.formatRelativeDay('2026-09-29T06:00:00Z', 'en', now)).toBe('today');
    expect(format.phone.formatRelativeDay('2026-09-28T21:30:00Z', 'en', now)).toBe('today');
    expect(format.phone.formatRelativeDay('2026-09-28T10:00:00Z', 'en', now)).toBe('yesterday');
    expect(format.phone.formatRelativeDay('2026-09-28 10:00:00+00', 'ar', now)).toBe('أمس');
  });
});

describe('the catalogue', () => {
  const core = load<Core>('use-intl/core');
  const format = load<Format>('@/lib/format');

  /** Every message, by its full key. */
  function flatten(messages: object, prefix = ''): [string, string][] {
    return Object.entries(messages).flatMap(([key, value]): [string, string][] =>
      typeof value === 'string' ? [[`${prefix}${key}`, value]] : flatten(value as object, `${prefix}${key}.`),
    );
  }

  type Argument = { kind: 'plural' | 'number' | 'date' | 'select' | 'text'; options?: string[] };

  /** The arguments a message takes and what kind each is; tags separately. */
  function argumentsOf(elements: MessageFormatElement[], found = new Map<string, Argument>(), tags = new Set<string>()) {
    const note = (name: string, argument: Argument) => {
      // A number anywhere wins over plain text: `{count}` beside `{count, plural, …}`.
      if (!found.has(name) || found.get(name)?.kind === 'text') found.set(name, argument);
    };
    for (const element of elements) {
      switch (element.type) {
        case TYPE.argument:
          note(element.value, { kind: 'text' });
          break;
        case TYPE.number:
          note(element.value, { kind: 'number' });
          break;
        case TYPE.date:
        case TYPE.time:
          note(element.value, { kind: 'date' });
          break;
        case TYPE.plural:
          note(element.value, { kind: 'plural' });
          for (const option of Object.values(element.options)) argumentsOf(option.value, found, tags);
          break;
        case TYPE.select:
          note(element.value, { kind: 'select', options: Object.keys(element.options) });
          for (const option of Object.values(element.options)) argumentsOf(option.value, found, tags);
          break;
        case TYPE.tag:
          tags.add(element.value);
          argumentsOf(element.children, found, tags);
          break;
        default:
          break;
      }
    }
    return { found, tags };
  }

  const samples: Record<Argument['kind'], (argument: Argument) => unknown[]> = {
    // Arabic's six plural forms: zero, one, two, few (3–10), many (11–99), other.
    plural: () => [0, 1, 2, 3, 11, 100, 1234],
    number: () => [0, 7, 12500, 1234567],
    date: () => [new Date('2026-09-28T22:30:00Z'), new Date('2026-01-15T10:00:00Z')],
    select: (argument) => argument.options ?? ['other'],
    text: () => ['نص', 'Text'],
  };

  for (const locale of ['ar', 'en'] as const) {
    it(`writes every ${locale === 'ar' ? 'Arabic' : 'English'} message the same on the phone as on the website`, () => {
      const errors = { website: [] as string[], phone: [] as string[] };
      const translator = (side: 'website' | 'phone') =>
        core[side].createTranslator({
          locale,
          messages: catalogues[locale],
          formats: format[side].intlFormats,
          timeZone: 'Africa/Cairo',
          onError: (error) => errors[side].push(`${error.code}: ${error.message}`),
          getMessageFallback: ({ key, namespace }) => `fallback:${namespace ? `${namespace}.` : ''}${key}`,
        });
      const onWeb = onTheWebsite(() => translator('website'));
      const onPhone = translator('phone');

      const cases: Case[] = [];
      for (const [key, message] of flatten(catalogues[locale])) {
        if (!message.includes('{')) continue;
        const { found, tags } = argumentsOf(parse(message, { ignoreTag: false }));
        if (found.size === 0) continue;

        const markup = Object.fromEntries([...tags].map((tag) => [tag, (chunks: string) => `<${tag}>${chunks}</${tag}>`]));
        const base = Object.fromEntries([...found].map(([name, argument]) => [name, samples[argument.kind](argument)[0]]));
        // One argument at a time through its samples, the rest at their first.
        for (const [name, argument] of found) {
          for (const value of samples[argument.kind](argument)) {
            const values = { ...base, [name]: value, ...markup };
            const label = `${locale} ${key} ${name}=${value instanceof Date ? value.toISOString() : String(value)}`;
            cases.push({
              label,
              website: () => onWeb.markup(key as never, values as never),
              phone: () => onPhone.markup(key as never, values as never),
            });
          }
        }
      }

      expect(cases.length).toBeGreaterThan(100);
      expect(disagreements(cases)).toEqual([]);
      expect(errors.phone).toEqual(errors.website);
    });
  }
});
