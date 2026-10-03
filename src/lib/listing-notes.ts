/**
 * Why a moderator refused or took down a listing, and where that is kept.
 *
 * Since migration 347 the note is a row of job_moderation, which the listing's
 * company and the admins read. Before it, the note was the listing's own
 * rejection_note column — always null since — and so went wherever the
 * listing's row went. The website and the app read the listings, then their
 * notes here.
 *
 * Code reaches production before its migrations as often as after. Until
 * job_moderation exists, `notes` is null and `noteFor` answers with the
 * column the listing row still carries, so a refusal's reason is shown on
 * either side of the migration.
 */

export type NoteRow = { job_id: string; rejection_note: string | null };

type ReadError = { code?: string; message: string };

type ReadResult = { data: NoteRow[] | null; error: ReadError | null };

/**
 * Whether a read failed because the database does not have the table yet:
 * PGRST205 is PostgREST's answer for a table it has not heard of, 42P01
 * Postgres's own.
 */
export function isMissingTable(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

/**
 * The notes on these listings, by listing, read with the caller's own client
 * (`read` is its `job_moderation` select of `job_id, rejection_note` for the
 * ids). `notes` is null, without an error, on a database before 347.
 */
export async function listingNotes(
  read: (ids: string[]) => PromiseLike<ReadResult>,
  ids: string[],
): Promise<{ notes: Map<string, string | null> | null; error: ReadError | null }> {
  if (ids.length === 0) return { notes: new Map(), error: null };
  const { data, error } = await read(ids);
  if (isMissingTable(error)) return { notes: null, error: null };
  if (error) return { notes: null, error };
  return { notes: new Map((data ?? []).map((row) => [row.job_id, row.rejection_note])), error: null };
}

/** The note a listing shows: its job_moderation row's, or before 347 its own column's. */
export function noteFor(
  notes: Map<string, string | null> | null,
  listing: { id: string; rejection_note?: string | null },
): string | null {
  return notes ? (notes.get(listing.id) ?? null) : (listing.rejection_note ?? null);
}
