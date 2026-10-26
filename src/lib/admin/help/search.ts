/**
 * Matching for the admin guide's search box.
 *
 * Arabic is matched the way a person types it: diacritics are ignored, and
 * the letters that are the same word in different spellings compare equal —
 * أ إ آ with ا, ة with ه, ى with ي. Latin letters are compared case-insensitively.
 * The map back to the original string is what the highlights are drawn from,
 * so a match on «اعلان» still paints the «إعلان» on the page.
 */

const FOLD: Record<string, string> = {
  '\u0623': '\u0627', // أ
  '\u0625': '\u0627', // إ
  '\u0622': '\u0627', // آ
  '\u0629': '\u0647', // ة
  '\u0649': '\u064a', // ى
};

function isDiacritic(code: number): boolean {
  return (
    (code >= 0x0610 && code <= 0x061a) ||
    (code >= 0x064b && code <= 0x065f) ||
    code === 0x0670 ||
    (code >= 0x06d6 && code <= 0x06ed) ||
    code === 0x0640
  );
}

/** The folded form, for comparisons. Tatweel is dropped with the diacritics. */
export function foldArabic(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const code = input.codePointAt(i)!;
    const char = String.fromCodePoint(code);
    i += char.length;
    if (isDiacritic(code)) continue;
    out += FOLD[char] ?? char.toLowerCase();
  }
  return out;
}

/**
 * Folded text plus, for each folded character, where it begins and ends in
 * the original string.
 */
function foldWithSpans(input: string): { folded: string; spans: Array<[number, number]> } {
  let folded = '';
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < input.length; ) {
    const code = input.codePointAt(i)!;
    const char = String.fromCodePoint(code);
    const next = i + char.length;
    if (!isDiacritic(code)) {
      const mapped = FOLD[char] ?? char.toLowerCase();
      for (let unit = 0; unit < mapped.length; unit += 1) {
        folded += mapped[unit];
        spans.push([i, next]);
      }
    }
    i = next;
  }
  return { folded, spans };
}

export function queryTokens(query: string): string[] {
  return foldArabic(query).split(/\s+/).filter(Boolean);
}

/** Inclusive-exclusive ranges in `text` covered by any token of `query`. */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const tokens = queryTokens(query);
  if (!tokens.length || !text) return [];
  const { folded, spans } = foldWithSpans(text);
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    let from = 0;
    while (from <= folded.length - token.length) {
      const at = folded.indexOf(token, from);
      if (at < 0) break;
      const start = spans[at][0];
      const end = spans[at + token.length - 1][1];
      ranges.push([start, end]);
      from = at + token.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export type LocalizedField = { label: string; detail: string };
export type LocalizedStatus = { label: string; detail?: string; tone: import('./types').HelpTone };
export type LocalizedFeature = {
  id: string;
  title: string;
  summary: string;
  href?: string;
  steps: string[];
  fields: LocalizedField[];
  statuses: LocalizedStatus[];
  tips: string[];
};
export type LocalizedSection = {
  id: string;
  title: string;
  lede: string;
  features: LocalizedFeature[];
};

export function featureHaystack(feature: LocalizedFeature): string {
  return [
    feature.title,
    feature.summary,
    ...feature.steps,
    ...feature.fields.flatMap((field) => [field.label, field.detail]),
    ...feature.statuses.flatMap((status) => [status.label, status.detail ?? '']),
    ...feature.tips,
  ].join('\n');
}

function containsEvery(text: string, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const folded = foldArabic(text);
  return tokens.every((token) => folded.includes(token));
}

/**
 * Sections whose title or introduction matches stay whole. Otherwise only
 * the features that match are kept, and a section with none is dropped.
 */
export function filterHelp(sections: LocalizedSection[], query: string): LocalizedSection[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return sections;
  const kept: LocalizedSection[] = [];
  for (const section of sections) {
    const sectionHit = containsEvery(`${section.title}\n${section.lede}`, tokens);
    const features = sectionHit
      ? section.features
      : section.features.filter((feature) => containsEvery(featureHaystack(feature), tokens));
    if (!sectionHit && features.length === 0) continue;
    kept.push(features.length === section.features.length ? section : { ...section, features });
  }
  return kept;
}
