import { NextResponse } from 'next/server';
import { createTranslator } from 'next-intl';
import { getViewer } from '@/lib/auth';
import { asLocale } from '@/lib/locale';
import { syncMyJobNotifications } from '@/lib/actions/notifications';
import { countUnreadNotifications, readNotificationFeed } from '@/lib/notifications/feed';
import { notificationTitle, type Translate } from '@/lib/notifications/title';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const headers = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
};

/**
 * The header bell's feed.
 *
 * Public pages are cached, so the header cannot read this during render.
 * The browser asks here, under the reader's own session. Titles are built
 * on the server, in the page's locale, from the same sentences the feed uses.
 * Nothing in the answer is the payload itself — a note, when there is one,
 * is the one line under the title.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = asLocale(url.searchParams.get('locale') ?? '');
  const viewer = await getViewer();
  if (!viewer?.profile) return NextResponse.json({ signedIn: false }, { headers });

  const supabase = await createClient();

  // The badge asks this every half minute. A head count, not the rows: the
  // list is read when the panel opens.
  if (url.searchParams.get('count') === '1') {
    const { unread, error } = await countUnreadNotifications(supabase, viewer.userId);
    if (error) console.warn('[notify] bell count failed:', error.message);
    return NextResponse.json({ signedIn: true, unread }, { headers });
  }

  // Listings that ended have no row change to trigger on. The same sweep the
  // feed runs, scoped to this reader's company, and a no-op for a candidate.
  if (viewer.profile.role === 'employer' || viewer.profile.role === 'admin') {
    await syncMyJobNotifications();
  }

  const { rows, unread, error } = await readNotificationFeed(supabase, viewer.userId);
  if (error) console.warn('[notify] bell feed failed:', error.message);

  const messages = (await import(`../../../../messages/${locale}.json`)).default;
  const t = createTranslator({ locale, messages }) as unknown as Translate;

  return NextResponse.json(
    {
      signedIn: true,
      unread,
      items: rows.map((row) => {
        const rawNote = row.payload?.note;
        const note = typeof rawNote === 'string' ? rawNote.replace(/\s+/g, ' ').trim() : '';
        return {
          id: row.id,
          kind: row.kind,
          title: notificationTitle(row, locale, t),
          detail: note,
          createdAt: row.created_at,
          unread: row.read_at == null,
        };
      }),
    },
    { headers },
  );
}
