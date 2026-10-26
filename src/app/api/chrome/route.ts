import { NextResponse } from 'next/server';
import { actorOf, getViewer } from '@/lib/auth';
import { asksToAgree } from '@/lib/policies';
import { canBrowseAgentDirectory, homeFor, postJobHref } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const headers = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
};

/**
 * The signed-in chrome the cached public pages cannot render themselves.
 *
 * Anonymous HTML stays anonymous. A browser that already has a session asks
 * here, after paint is held, and swaps the header. Nothing in the answer is
 * cacheable and the route is not a page.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ signedIn: false }, { headers });

  const supabase = await createClient();
  // An active push device is a phone this person has signed in on with
  // the app and allowed notifications. A failed read is not that.
  const { count: devices, error: devicesError } = await supabase
    .from('push_devices')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', viewer.userId)
    .is('disabled_at', null);
  const hasApp = !devicesError && (devices ?? 0) > 0;

  if (!viewer.profile) {
    return NextResponse.json(
      {
        signedIn: true,
        hasProfile: false,
        name: viewer.suggestedName,
        avatarUrl: null,
        role: null,
        homeHref: '/onboarding',
        postJobHref: null,
        showAgents: false,
        asksToAgree: false,
        unread: 0,
        hasApp,
      },
      { headers },
    );
  }

  const actor = actorOf(viewer);
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', viewer.userId)
    .is('read_at', null);

  return NextResponse.json(
    {
      signedIn: true,
      hasProfile: true,
      name: viewer.profile.full_name,
      avatarUrl: viewer.profile.avatar_url,
      role: viewer.profile.role,
      homeHref: homeFor(actor),
      postJobHref: postJobHref(actor),
      showAgents: canBrowseAgentDirectory(actor),
      asksToAgree: await asksToAgree(viewer),
      unread: count ?? 0,
      hasApp,
    },
    { headers },
  );
}
