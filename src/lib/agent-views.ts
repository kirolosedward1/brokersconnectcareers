import 'server-only';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logFailure } from '@/lib/observe';

/**
 * Records that a company opened a consultant's profile.
 *
 * A log rather than a counter, and the reasoning is in migration 63: a counter
 * incremented on every page load would count the owner's own previews, count
 * one employer's refresh twice, and mix in signed-out traffic that is not
 * hiring anybody. What a consultant is shown is "three companies looked",
 * which is a sentence the log can support and a counter cannot.
 *
 * Everything is decided inside `record_agent_view()` — which company the
 * caller acts for, whether they are the owner, whether the slug exists — so
 * this passes the slug and nothing else. Every refusal is silent, because none
 * of them is a failure the reader should hear about.
 *
 * Through `after()`, so reading a profile is never held up by a write nobody
 * is waiting for. The client is built out here rather than inside the
 * callback, and that is not style: Next refuses to read `cookies` inside
 * `after()` — the request is over by then — so the session has to be captured
 * while the request is still alive and closed over. The first thing in this
 * codebase to do it the other way round wrote nothing at all.
 */
export async function recordAgentView(slug: string): Promise<void> {
  const supabase = await createClient();

  after(async () => {
    try {
      const { error } = await supabase.rpc('record_agent_view', { p_slug: slug });
      if (error) {
        logFailure('directory', 'could not record a profile view', { slug, code: error.code });
      }
    } catch (error) {
      logFailure('directory', 'could not record a profile view', {
        slug,
        detail: error instanceof Error ? error.message : 'unknown',
      });
    }
  });
}
