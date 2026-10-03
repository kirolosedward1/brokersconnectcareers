/**
 * A search term safe to put inside a PostgREST filter expression.
 *
 * `.or()` takes an expression in PostgREST's own grammar, and the company
 * search interpolated the raw query into one — so a search containing a comma
 * became extra OR terms, one containing `)` became a syntax error, and `%` or
 * `_` became `ilike` wildcards nobody typed. A brokerage called
 * "الرواد، للتطوير" could not be searched for by its own name.
 *
 * Stripped rather than escaped: PostgREST's grammar offers no escape for the
 * separators, and a name with punctuation in it still matches on the words
 * either side. Its own file, with no imports, so the test suite can reach it
 * — everything in `queries/` pulls in the server client and `server-only`.
 */
export function likeNeedle(value: string): string {
  return value
    .replace(/[%_(),*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The same term, with the letters Arabic spells more than one way left open:
 * أ إ آ ٱ and ا as any one letter, and a final ة/ه and ى/ي likewise. The
 * console's lists compare raw text (ilike), so «احمد» found nobody called
 * «أحمد», and «مصطفي» no «مصطفى». `_` is ilike's one-letter wildcard;
 * likeNeedle has already taken out any the reader typed. A term that would be
 * wildcards and nothing else is left as typed.
 */
export function looseArabicNeedle(value: string): string {
  const needle = likeNeedle(value).replace(/[ً-ْٰـ]/g, '');
  const loose = needle
    .replace(/[اأإآٱ]/g, '_')
    .replace(/[ةه](?=\s|$)/g, '_')
    .replace(/[ىي](?=\s|$)/g, '_');
  return /[^\s_]/.test(loose) ? loose : needle;
}
