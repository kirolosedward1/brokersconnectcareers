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
