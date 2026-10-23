/**
 * A create that a retry cannot make twice.
 *
 * A form that gave up waiting — a phone between towers, café Wi-Fi — may have
 * been answered by a server that had already written the row; pressed again,
 * the second request was a second row. The form makes one key when it opens
 * and sends it with every attempt; the table holds it under a unique index
 * per owner (migration 356, and 55 for listings), so the second insert is
 * refused and the row the first one made is the answer.
 *
 * Looked up after any refusal, not only a unique violation: a CV at its cap
 * refuses the retry with `cap` before the index is reached, and the entry the
 * first attempt added is still what the person meant.
 *
 * Before migration 356 is applied (code deploys first), PostgREST refuses the
 * unknown column; the row is then written without it, exactly as before.
 *
 * Pure, so the rules can be tested without a database.
 */

export type Attempt<T> = {
  data: T | null;
  error: { code?: string | null; message: string } | null;
};

/** PostgREST's "no such column" on a write (PGRST204) and Postgres's own (42703). */
export function missingColumn(error: Attempt<unknown>['error']): boolean {
  return error?.code === 'PGRST204' || error?.code === '42703';
}

export async function insertOnce<T>(
  key: string | null | undefined,
  insert: (withKey: boolean) => PromiseLike<Attempt<T>>,
  already: () => PromiseLike<Attempt<T>>,
): Promise<Attempt<T>> {
  if (!key) return insert(false);

  const first = await insert(true);
  if (!first.error) return first;
  if (missingColumn(first.error)) return insert(false);

  const found = await already();
  return found.data ? { data: found.data, error: null } : first;
}
