import { isAwaitedOAuthReturn } from '~/features/auth/oauth-return';
import { readLastActor } from '~/lib/last-actor';
import { isPublicPath, routeFromOutside, webPathToAppPath } from '~/lib/links';
import { openWhenReady } from '~/lib/open-path';

/**
 * Every address the system hands the app — a universal link to the website,
 * a brokersconnect:// link, a cold start from either — becomes the app path of
 * the same page, in the tab that page belongs to, for the person last signed
 * in on this phone: the tab bar is drawn for the same person (the root layout
 * waits for the same answer), so the two agree. A signed-in page with nobody
 * signed in opens the sign-in sheet instead, which comes back to it
 * (src/lib/links.ts). What is not ours opens the home screen.
 *
 * When the phone remembers nobody, a signed-in page waits instead: whether
 * somebody is signed in is known once the stored session has been read, and
 * PendingPath opens it (or the sign-in sheet) then. Nothing opens meanwhile.
 */
export async function redirectSystemPath({ path }: { path: string; initial: boolean }): Promise<string | null> {
  // Google's return, which the sign-in screen is waiting for itself (oauth-return.ts).
  if (isAwaitedOAuthReturn(path)) return null;
  try {
    const actor = await readLastActor();
    if (!actor && !isPublicPath(path)) {
      openWhenReady(webPathToAppPath(path));
      return null;
    }
    return routeFromOutside(path, actor);
  } catch {
    return '/';
  }
}
