'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { getViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/actions/jobs';
import { FALLBACK_HREF } from '@/lib/notifications/links';
import { resolveNotification } from '@/lib/notifications/open';

/**
 * Mark the reader's feed as read — up to the newest notification they were
 * shown.
 *
 * `upTo` is the created_at of the newest row on the screen the button was
 * pressed from. A tab rendered an hour ago must not clear a notification that
 * arrived since and that it never displayed; without the bound, "mark all
 * read" in a stale tab silently swallowed whatever came in after it loaded.
 * Omitted, it means everything, as before.
 *
 * One statement in the database, scoped to auth.uid() inside the function —
 * there is no user id to pass, so there is none to get wrong.
 */
export async function markNotificationsRead(
  upTo?: string | null,
): Promise<ActionResult<{ marked: number }>> {
  const bound = upTo && !Number.isNaN(Date.parse(upTo)) ? upTo : null;

  const supabase = await createClient();
  let { data, error } = await supabase.rpc('mark_notifications_read', { p_up_to: bound });
  // PGRST202: no function with that argument — a database migration 301 has
  // not reached yet. The unbounded form is what it had, and still marks read.
  if (error?.code === 'PGRST202') ({ data, error } = await supabase.rpc('mark_notifications_read', {}));
  if (error) return { ok: false, error: error.message };

  // The badge is in both headers, so every page is stale.
  revalidatePath('/', 'layout');
  return { ok: true, data: { marked: data ?? 0 } };
}

const openSchema = z.object({ id: z.string().uuid(), locale: z.string() });

/**
 * Follow one notification: mark it read, then go where it points — if the
 * reader may, and if it is still there.
 *
 * A form action rather than a link, for three reasons. Marking read is a
 * write, and a GET that writes is a GET the router's prefetcher performs on
 * every row that scrolls into view. A form posts without JavaScript, so the
 * bell works on a bad connection before any bundle arrives. And the decision
 * about where to send somebody is made on the server, at the moment they ask,
 * against their role and the current state of the target — not frozen into
 * an <a href> when the row was written.
 *
 * Where it may send them is decided in notifications/open.ts, which the
 * mobile app's feed asks too.
 */
export async function openNotification(formData: FormData): Promise<void> {
  const parsed = openSchema.safeParse({
    id: formData.get('id'),
    locale: formData.get('locale'),
  });
  const locale = asLocale(parsed.success ? parsed.data.locale : String(formData.get('locale') ?? ''));
  if (!parsed.success) redirect({ href: FALLBACK_HREF, locale });

  const viewer = await getViewer();
  if (!viewer?.profile) redirect({ href: '/sign-in', locale });
  const role = viewer!.profile!.role;

  const supabase = await createClient();
  const destination = await resolveNotification(supabase, parsed.data!.id, role);

  revalidatePath('/', 'layout');

  redirect({ href: 'href' in destination ? destination.href : destination.fallback, locale });
}

/**
 * The expiry sweep for the caller's own company.
 *
 * "Your listing ended" has no row change to trigger on, and the nightly cron
 * that would write it cannot run on a deployment without the service-role
 * key. So the console runs the same sweep, scoped in the database to the
 * caller's company, when an employer opens the feed. Idempotent — the keys
 * carry each listing's expires_at — so running it on every load writes each
 * notice once. Never throws: a bell that failed to catch up is still a bell.
 */
export async function syncMyJobNotifications(): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('sync_my_job_notifications');
    if (error) console.warn('[notify] expiry sync failed:', error.message);
  } catch (error) {
    console.warn('[notify] expiry sync failed:', error instanceof Error ? error.message : error);
  }
}
