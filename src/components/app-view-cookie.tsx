'use client';

import { useLayoutEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { persistAppView } from '@/lib/app-view';

/**
 * Remembers `?app=1` for the rest of the browser session.
 *
 * Mounted on every page, inside a Suspense boundary so reading the query
 * does not stop the page being cached. Renders nothing. The results card
 * reads the same cookie; this is what writes it when the flag arrives on
 * a page that has no card of its own (the home page, a policy).
 */
export function AppViewCookie() {
  const searchParams = useSearchParams();

  useLayoutEffect(() => {
    const wrote = persistAppView(
      { search: window.location.search, protocol: window.location.protocol },
      (value) => {
        document.cookie = value;
      },
    );
    if (wrote) window.dispatchEvent(new Event('bc-app-view'));
    // The query is the signal. searchParams changes on a client navigation
    // that keeps this layout mounted, which a full reload would not need.
  }, [searchParams]);

  return null;
}
