import { raise } from '@/lib/queries/error';

type Result<T> = { data: T | null; error: { message?: string; code?: string | null; details?: string | null; hint?: string | null } | null; count?: number | null };

/**
 * The data, or an error the console's boundary can show.
 *
 * Console reads never degrade to an empty list: "nothing is waiting" is the
 * answer a moderator acts on by going away, so a read that failed must not be
 * able to say it. And when the failure is that the database has not been
 * migrated yet — the code reaches production before its migrations as often
 * as after — the message says so, rather than a column name nobody can act on.
 */
export function must<T>(result: Result<T>, context: string): { data: T; count: number } {
  if (result.error) {
    const code = result.error.code ?? '';
    if (code === 'PGRST202' || code === '42883' || code === '42703' || code === '42P01' || code === 'PGRST200') {
      throw new Error(
        `${context}: the database is missing the operations console or moderation schema. ` +
          'Apply supabase/migrations 202–210 (pnpm db:push:url) and reload.',
        { cause: result.error },
      );
    }
    raise(result.error, context);
  }
  // Passed through as it came. A single-row read that found nothing is null,
  // and must stay null: coercing it to [] made "no consultant profile" truthy,
  // and an employer's page grew an empty consultant panel.
  return { data: result.data as T, count: result.count ?? 0 };
}

/**
 * A page of a list, or a redirect to its first page when the page number in
 * the URL is past the end. PostgREST refuses an offset beyond the result set
 * outright (PGRST103) — a filter that shrank the list under a bookmarked page
 * four would otherwise render the error boundary instead of the list.
 */
export async function mustPage<T>(
  result: Result<T>,
  context: string,
  locale: string,
  firstPage: string,
): Promise<{ data: T; count: number }> {
  if (result.error?.code === 'PGRST103') {
    const { redirect } = await import('@/i18n/navigation');
    redirect({ href: firstPage, locale });
  }
  return must(result, context);
}
