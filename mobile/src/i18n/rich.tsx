/**
 * The two rich-text tags the catalogue uses, for React Native.
 *
 * `<v>` wraps a number inside a sentence — "<v>7,000</v> – <v>10,000</v> جنيه".
 * On the website it is a left-to-right span, so the digits are not reordered
 * by the Arabic around them while the range still reads in the sentence's own
 * direction. Text in React Native has no span with a direction of its own, so
 * the same effect comes from Unicode: a left-to-right isolate (U+2066 … U+2069)
 * around each number.
 *
 * `<b>` carries emphasis the caller styles; as a string it is the words alone.
 *
 * For `t.markup(key, { ...values, ...markupTags })`, which returns a string.
 */
export const LRI = '\u2066';
export const PDI = '\u2069';

export const markupTags = {
  v: (chunks: string) => `${LRI}${chunks}${PDI}`,
  b: (chunks: string) => chunks,
};

/** A value that is a number, isolated the same way, for sentences built in code. */
export function isolate(text: string): string {
  return `${LRI}${text}${PDI}`;
}
