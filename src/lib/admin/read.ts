import { raise } from '@/lib/queries/error';
import { pageAfterTheEnd } from '@/lib/admin/params';

type Result<T> = { data: T | null; error: { message?: string; code?: string | null; details?: string | null; hint?: string | null } | null; count?: number | null };

/**
 * The data, or an error the console's boundary can show.
 *
 * Console reads never degrade to an empty list: "nothing is waiting" is the
 * answer a moderator acts on by going away, so a read that failed must not be
 * able to say it. And when the failure is that the database has not been
 * migrated yet — the code reaches production before its migrations (316–319
 * for the console, 325–328 for moderation) as often as after — the message
 * says so, rather than a column name nobody can act on.
 */
export function must<T>(result: Result<T>, context: string): { data: T; count: number } {
  if (result.error) {
    const code = result.error.code ?? '';
    if (code === 'PGRST202' || code === '42883' || code === '42703' || code === '42P01' || code === 'PGRST200') {
      // Not db:push:url: on a database with data — production — it re-runs
      // every migration and the seed. db:apply lists only what is missing.
      throw new Error(
        `${context}: the database is missing migrations this page reads. ` +
          'Run pnpm db:apply (with TARGET_DATABASE_URL) to list them, then apply them and reload.',
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
 * A page of a list, or a redirect when the page number in the URL is past the
 * end. PostgREST refuses an offset beyond the result set outright (PGRST103) —
 * a filter that shrank the list under a bookmarked page four would otherwise
 * render the error boundary instead of the list — and answers an offset of
 * exactly the total with no rows, which would say "nothing waiting"
 * (pageAfterTheEnd). The first goes to page one, the second to the last page.
 */
export async function mustPage<T>(
  result: Result<T>,
  context: string,
  locale: string,
  { page, size, href }: { page: number; size?: number; href: (page: number) => string },
): Promise<{ data: T; count: number }> {
  if (result.error?.code === 'PGRST103') await goTo(href(1), locale);
  const read = must(result, context);
  const rows = Array.isArray(read.data) ? read.data.length : 0;
  await leaveAnEmptyPage(locale, { page, rows, total: read.count, size, href });
  return read;
}

/**
 * For a list read through a database function, which counts its total over
 * the rows it returns: a page past the end comes back empty, its total 0.
 */
export async function leaveAnEmptyPage(
  locale: string,
  { page, rows, total, size, href }: { page: number; rows: number; total: number | null; size?: number; href: (page: number) => string },
): Promise<void> {
  const next = pageAfterTheEnd({ page, rows, total, size });
  if (next !== null) await goTo(href(next), locale);
}

async function goTo(href: string, locale: string): Promise<never> {
  const { redirect } = await import('@/i18n/navigation');
  return redirect({ href, locale });
}
