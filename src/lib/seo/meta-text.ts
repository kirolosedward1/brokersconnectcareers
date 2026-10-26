/**
 * Lengths Google actually shows.
 *
 * A title past about 60 characters is cut in the result, and a description
 * past about 155 is cut mid-sentence. Shorter than about 50 and 120, the
 * result looks thin next to one that fills the line. Trimming happens on a
 * space when there is one in the kept part, so a word is not sliced.
 */

function collapse(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function cut(text: string, max: number, minKeep: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const space = slice.lastIndexOf(' ');
  const kept = space >= minKeep ? slice.slice(0, space) : slice;
  return kept.replace(/[\s—–\-·,،.]+$/u, '');
}

/** A title, at most `max` characters. Nothing is added when the text is short. */
export function fitTitle(input: string, max = 60): string {
  return cut(collapse(input), max, Math.floor(max * 0.6));
}

/**
 * Characters left for a page title once the layout appends ` | ${siteName}`.
 * Fitting to this keeps the document title within 60.
 */
export function titleRoom(siteName: string, max = 60): number {
  return max - ` | ${siteName}`.length;
}

/**
 * A description, 120–155 characters when `pad` can make up a shortfall.
 *
 * `pad` is a factual clause (salary, commission, lead source) — never a
 * keyword list. It is appended only while the text is under 120, then the
 * result is trimmed again if that pushed it past 155.
 */
export function fitDescription(input: string, pad = ''): string {
  let text = collapse(input);
  const extra = collapse(pad);
  if (text.length < 120 && extra) {
    text = collapse(`${text} ${extra}`);
  }
  return cut(text, 155, 120);
}
