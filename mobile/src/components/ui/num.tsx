import type { ComponentProps } from 'react';
import type { TextStyle } from 'react-native';
import { useLocale } from 'use-intl';
import { formatNumber } from '@/lib/format';
import { toNumerals, useAppPreferences } from '~/features/preferences/app-preferences';
import { isolate } from '~/i18n/rich';
import { Text } from './text';

/**
 * The marks Arabic number formatting can put round a figure (the Arabic
 * letter mark before a minus, the left-to-right and right-to-left marks).
 * A number drawn here is already isolated left to right, so they only move
 * its sign away from it.
 */
const BIDI_MARKS = /[\u061C\u200E\u200F]/g;

/** A true minus, as type sets it: a hyphen is shorter than the plus beside it. */
const MINUS = '\u2212';

export type NumOptions = {
  /** "+18" for a rise: a plus on anything above nought. */
  signed?: boolean;
  /** "18%". */
  percent?: boolean;
};

/**
 * A number as `Num` writes it: formatted the website's way (Western digits,
 * grouped), its sign and its percent kept against it — "+18%", "−3" — and
 * nothing of the sentence's direction inside it. Text already written
 * ("10 / 20", "11:00") is only cleaned of those marks.
 */
export function numText(value: number | string, locale: string, { signed = false, percent = false }: NumOptions = {}): string {
  if (typeof value === 'string') return value.replace(BIDI_MARKS, '');
  const sign = value < 0 ? MINUS : signed && value > 0 ? '+' : '';
  return `${sign}${formatNumber(Math.abs(value), locale).replace(BIDI_MARKS, '')}${percent ? '%' : ''}`;
}

/**
 * Every figure the same width, so a column of them lines up and a count
 * rolling up does not jitter. For a line of words with isolated numbers in
 * it ("من 12,000"), whose words keep the sentence's direction.
 */
export const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

/** What makes a run of text a number: tabular figures, left to right. Only for a run that is nothing but the number. */
export const NUM_STYLE: TextStyle = { ...TABULAR, writingDirection: 'ltr' };

type Props = Omit<ComponentProps<typeof Text>, 'children'> & NumOptions & { value: number | string };

/**
 * Every number the app draws on its own or inside a sentence — a count, a
 * percentage, a time, a price, a range. Left to right and isolated, so the
 * Arabic around it never reorders its digits or pulls its sign away; set in
 * tabular figures, in the digits chosen under Appearance; and, being a Text, it starts where the line starts, so on
 * its own it sits at the right in Arabic. Inside another Text it is a run of
 * that line.
 */
export function Num({ value, signed, percent, style, ...props }: Props) {
  const locale = useLocale();
  const { numerals } = useAppPreferences();
  return (
    <Text {...props} style={[NUM_STYLE, style]}>
      {isolate(toNumerals(numText(value, locale, { signed, percent }), numerals, locale))}
    </Text>
  );
}
