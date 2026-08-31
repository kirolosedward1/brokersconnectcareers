import 'server-only';

type Attempt<T> = {
  data: T | null;
  error: { code?: string | null; message: string } | null;
};

/**
 * Inserts a row whose slug carries a random id, retrying with a fresh id if the
 * database reports that slug already taken.
 *
 * Six random digits alongside a name collide rarely, but "rarely" over enough
 * signups is "eventually", and the failure a user would see is an opaque
 * constraint violation on a form that looked fine. Only a slug conflict is
 * retried — the other unique constraints on these tables (one company per
 * owner, one agent profile per user) are real answers and must surface.
 */
export async function withUniqueSlug<T>(
  build: () => string,
  // PromiseLike, not Promise: Supabase's query builder is thenable but is not a
  // real Promise.
  insert: (slug: string) => PromiseLike<Attempt<T>>,
  attempts = 4,
): Promise<Attempt<T>> {
  let result = await insert(build());

  for (let tries = 1; tries < attempts; tries += 1) {
    const conflictedOnSlug =
      result.error?.code === '23505' && result.error.message.toLowerCase().includes('slug');
    if (!conflictedOnSlug) return result;

    result = await insert(build());
  }

  return result;
}
