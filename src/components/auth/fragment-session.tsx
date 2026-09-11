'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * A session that arrived in the URL fragment, spent.
 *
 * Every link the app itself asks Supabase for uses the PKCE flow: the browser
 * lands on /auth/callback?code=… and the server exchanges the code. But links
 * that Supabase mints without the app's involvement — "Send password
 * recovery" and "Send magic link" on the dashboard's Users page, or any call
 * to /auth/v1/recover that did not carry a code challenge — use the older
 * implicit flow, and the session comes back as a fragment on the Site URL:
 *
 *   https://www.brokersconnect.net/#access_token=…&refresh_token=…&type=recovery
 *
 * A fragment never reaches the server, so the middleware that rescues a stray
 * ?code= at the root could not see it, and the page rendered as if nobody had
 * clicked anything. The reader was looking at the home page, signed out, with
 * a valid session sitting in the address bar.
 *
 * This runs once on the client, on every page, and does nothing unless the
 * fragment is one of those. It stores the session through the same client the
 * app already uses, wipes the fragment so a reload cannot replay it, and goes
 * where the link type says: a recovery to the new-password form, an expired
 * or already-used link to sign-in with a sentence that says so, anything else
 * to onboarding — which sends a reader who already has a profile on to their
 * console.
 */
export function FragmentSession() {
  const router = useRouter();

  useEffect(() => {
    // On mount, and again if the fragment changes without a navigation — which
    // is what a same-document link to "/#access_token=…" is. A real click from
    // an email is a full navigation and takes the mount path.
    const spend = () => {
    const hash = window.location.hash;
    if (hash.length < 2) return;

    const params = new URLSearchParams(hash.slice(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');
    const failed = params.has('error') || params.has('error_code');
    if (!accessToken && !failed) return;

    // The fragment is a credential. Off the address bar before anything else,
    // so a reload, a screenshot or a shared URL does not carry it.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    if (failed || !refreshToken) {
      router.replace({ pathname: '/sign-in', query: { error: 'link_expired' } });
      return;
    }

    createClient()
      .auth.setSession({ access_token: accessToken!, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          router.replace({ pathname: '/sign-in', query: { error: 'link_expired' } });
          return;
        }
        router.replace(type === 'recovery' ? '/sign-in/new-password' : '/onboarding');
        router.refresh();
      });
    };

    spend();
    window.addEventListener('hashchange', spend);
    return () => window.removeEventListener('hashchange', spend);
  }, [router]);

  return null;
}
