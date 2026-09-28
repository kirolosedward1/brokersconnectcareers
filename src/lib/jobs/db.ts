import { DB_RETRY, withRetry, type DbErrorLike } from './policy';

/**
 * Supabase calls, retried through a transient blip.
 *
 * supabase-js does not throw: it resolves `{ data, error }`, and a dropped
 * connection arrives as an error with no code and "fetch failed" for a
 * message. withRetry needs a throw to act on, so these two adapt one to the
 * other — and back, for callers like deliver() whose contract is never to
 * throw at all.
 *
 * Only transient failures are retried (policy.isTransientDbError). A
 * constraint violation or a permission refusal comes back on the first try.
 */

type Response<T> = PromiseLike<
  { data: T; error: null } | { data: unknown; error: DbErrorLike & { message: string } }
>;

/** A database failure as a thrown Error, keeping the Postgres/PostgREST code. */
export class DbError extends Error {
  readonly code: string | undefined;
  constructor(error: DbErrorLike) {
    super(error.message ?? 'database error');
    this.name = 'DbError';
    this.code = error.code ?? undefined;
  }
}

/**
 * The data, or a thrown DbError once retries are spent. For background work,
 * where a failure should fail the run and be recorded as such.
 */
export async function retryDb<T>(query: () => Response<T>): Promise<T> {
  return withRetry(async () => {
    const result = await query();
    if (result.error) throw new DbError(result.error);
    return result.data as T;
  }, DB_RETRY);
}

/**
 * The same retry, resolved back into `{ data, error }` for callers that must
 * never throw.
 */
export async function retryDbResult<T>(
  query: () => Response<T>,
): Promise<{ data: T; error: null } | { data: null; error: DbError }> {
  try {
    return { data: await retryDb(query), error: null };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof DbError
          ? error
          : new DbError({ message: error instanceof Error ? error.message : String(error) }),
    };
  }
}
