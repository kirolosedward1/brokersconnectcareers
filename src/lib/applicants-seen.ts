import 'server-only';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logFailure } from '@/lib/observe';

/**
 * Records that an employer has actually laid eyes on these applications.
 *
 * `employer_viewed_at` was only ever written by a pipeline move, so it did not
 * mean what its name says — it meant "somebody changed this application's
 * status". That made it useless for the one question a candidate has after
 * applying, which is whether anyone looked at all; showing it as "they opened
 * your application" would have been a sentence the data could not support.
 *
 * Now the inbox writes it, which is the moment it describes. The card an
 * employer sees carries the name, the experience band, the note and the link
 * to the CV — if that has been on their screen, the application has been
 * opened, and the candidate is owed that much.
 *
 * Through `after()`, so a read is never held up by a write it does not need,
 * and through the caller's own session, so `applications_update_employer`
 * decides which rows may be stamped rather than this function being trusted
 * about it. Its failure is logged and swallowed: an employer looking at their
 * inbox should not see an error because a timestamp did not save.
 *
 * The client is built out here rather than inside the callback, and that is
 * not style. Next refuses to read `cookies` inside `after()` — the request is
 * over by then — so the session has to be captured while the request is still
 * alive and closed over. The first version did it the other way and wrote
 * nothing at all; it took one line in the log to find, which is the whole
 * argument for having put that line there.
 */
export async function markApplicantsSeen(applicationIds: string[]): Promise<void> {
  if (!applicationIds.length) return;

  const supabase = await createClient();

  after(async () => {
    try {
      const { error } = await supabase
        .from('applications')
        .update({ employer_viewed_at: new Date().toISOString() })
        .in('id', applicationIds)
        .is('employer_viewed_at', null);

      if (error) {
        logFailure('pipeline', 'could not record that applicants were seen', {
          count: applicationIds.length,
          code: error.code,
        });
      }
    } catch (error) {
      logFailure('pipeline', 'could not record that applicants were seen', {
        count: applicationIds.length,
        detail: error instanceof Error ? error.message : 'unknown',
      });
    }
  });
}
