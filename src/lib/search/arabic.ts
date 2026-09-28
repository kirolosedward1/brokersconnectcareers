/**
 * Arabic search normalisation, and the query built from it.
 *
 * `to_tsvector('simple', …)` does no stemming and no folding, which in Arabic
 * means ordinary spelling variation breaks matching outright. A listing in
 * المعادي is not found by معادي; مُهندس with harakat is not found by مهندس
 * without them; استشارى typed with a dotless ya is not found by استشاري; مسئول
 * is not found by مسؤول. Nobody notices at fifteen listings. At five hundred it
 * reads as "your search is broken" rather than as a tuning problem.
 *
 * What this does fold:
 *
 *   - NFKC first, so presentation forms pasted from a PDF (ﻻ, ﻣ) become letters
 *   - harakat, superscript alef and tatweel, which are typing noise
 *   - invisible bidi and joiner characters, which a copy from a web page carries
 *   - أ إ آ ٱ → ا, because which hamza somebody typed is not a distinction
 *     anybody is searching on
 *   - ؤ ئ → ء, so the two seats people swap between (مسئول / مسؤول) meet
 *   - ى → ي and ة → ه, the two endings Egyptian typing writes interchangeably.
 *     ة only ever ends a word, so this is a word-final fold, not a general one
 *   - ی ک → ي ك, the Persian code points some keyboards produce
 *   - Arabic-Indic digits → Western, so ٥ finds 5
 *   - ال, and ال behind و ف ب ك (and لل), by indexing both forms and querying
 *     the bare one
 *
 * What it deliberately does not do is pretend to stem. شقة and شقق are a
 * broken plural: no amount of character folding connects them, and a
 * hand-rolled stemmer would be worse than none — it would silently merge words
 * that are genuinely different. Suffixes are handled the honest way instead: a
 * prefix match on the short, structured fields, so مهندس finds مهندسين.
 *
 * The folding exists twice, here and as public.ar_normalise() / ar_strip_al()
 * in the migrations, because one runs on the query and the other inside the
 * database. `pnpm test:search` feeds the same corpus through both and asserts
 * they agree, so the pair cannot drift apart unnoticed.
 *
 * No imports, on purpose: the test runner loads this file directly.
 */

/** Harakat, superscript alef, tatweel, and the invisible format characters. */
const NOISE = /[ً-ٰٟـ؜​-‏‪-‮⁦-⁩﻿]/g;

const FOLD: Record<string, string> = {
  'آ': 'ا',
  'أ': 'ا',
  'إ': 'ا',
  'ٱ': 'ا',
  'ى': 'ي',
  'ی': 'ي', // Persian yeh
  'ک': 'ك', // Persian keheh
  'ة': 'ه',
  'ؤ': 'ء',
  'ئ': 'ء',
};

/** ٠١٢٣٤٥٦٧٨٩ and the Extended Arabic-Indic ۰۱۲۳۴۵۶۷۸۹. */
export function westernDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

export function normaliseArabic(input: string): string {
  const folded = westernDigits(input.normalize('NFKC'))
    .replace(NOISE, '')
    .replace(/[آأإٱىیکةؤئ]/g, (ch) => FOLD[ch] ?? ch);

  // Only ASCII whitespace, and only a plain space trimmed, because that is
  // exactly what the SQL side does; NFKC has already turned the exotic spaces
  // into ordinary ones.
  return folded
    .toLowerCase()
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .replace(/^ | $/g, '');
}

/**
 * The same text with the article removed from each word — ال, or ال behind a
 * one-letter prefix (والمبيعات, بالتقسيط, للتطوير).
 *
 * Only where three letters are left behind: ال, الا, والي and فالح are words in
 * their own right rather than an article plus a noun. A word starts wherever
 * the character before it is not an Arabic letter, so «التجمع» and (المعادي)
 * are handled like any other word.
 */
export function stripDefiniteArticle(input: string): string {
  return input.replace(
    /(^|[^ء-ي])(?:[وفبك]?ال|لل)([ء-ي]{3,})/g,
    '$1$2',
  );
}

/**
 * What goes into the index: both forms, side by side.
 *
 * The written form so an exact search still matches it, the bare form so a
 * search without the article does. The query asks for the bare form only —
 * see queryWords — which every document carries whichever way it was written.
 */
export function searchText(input: string): string {
  const normalised = normaliseArabic(input);
  const stripped = stripDefiniteArticle(normalised);
  return stripped === normalised ? normalised : `${normalised} ${stripped}`;
}

/** Enough for any real search; a bound on what one query can ask of the index. */
const MAX_WORDS = 8;

/**
 * The words of a query, spelled the way the index spells them.
 *
 * Split on anything that is not a letter or a digit, which is also what makes
 * the result safe to put into a tsquery or a PostgREST filter: no operator,
 * quote, wildcard or separator can survive it.
 */
export function queryWords(input: string): string[] {
  return stripDefiniteArticle(normaliseArabic(input))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_WORDS);
}

/**
 * The multi-word names the query should keep together, from the taxonomy and
 * its aliases: «القاهرة الجديدة», "New Cairo", «إدارة أملاك».
 *
 * Without this, «القاهرة الجديدة» is two words, each matched on its own — and a
 * listing in «مصر الجديدة», which is in «القاهرة», has both of them.
 */
export function searchPhrases(names: readonly string[]): string[][] {
  const seen = new Set<string>();
  const phrases: string[][] = [];
  for (const name of names) {
    const words = queryWords(name);
    const key = words.join(' ');
    if (words.length < 2 || seen.has(key)) continue;
    seen.add(key);
    phrases.push(words);
  }
  // Longest first, so "New Administrative Capital" wins over "New Capital".
  return phrases.sort((a, b) => b.length - a.length);
}

/** Shorter than this and a prefix match is a match on almost everything. */
const MIN_PREFIX = 3;

/**
 * A `to_tsquery('simple', …)` expression for the board, or null when the query
 * has no searchable words in it.
 *
 * Each word must match somewhere (AND), and where it may match depends on the
 * field — the weights are set in migration 68:
 *
 *   A–C  title, track, place, company, developers: as a prefix, so مهندس
 *        finds مهندسين and "consult" finds "consultant"
 *   D    the description: whole words only, because a prefix match on prose
 *        (مبيع) is a match on every listing on the board
 *
 * A known multi-word name is matched as a phrase, word after word.
 */
export function buildJobQuery(input: string, phrases: readonly string[][] = []): string | null {
  const words = queryWords(input);
  if (!words.length) return null;

  const terms: string[] = [];
  for (let i = 0; i < words.length; ) {
    const phrase = phrases.find(
      (candidate) =>
        candidate.length <= words.length - i &&
        candidate.every((word, offset) => words[i + offset] === word),
    );

    if (phrase) {
      terms.push(`(${phrase.join(' <-> ')})`);
      i += phrase.length;
      continue;
    }

    const word = words[i];
    terms.push(word.length >= MIN_PREFIX ? `(${word}:*ABC | ${word}:D)` : word);
    i += 1;
  }

  return terms.join(' & ');
}
