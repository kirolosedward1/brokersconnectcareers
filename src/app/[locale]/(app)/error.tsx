'use client';

import { ErrorState } from '@/components/error-state';

/**
 * The signed-in console, and the reason it needs its own boundary.
 *
 * Without one, a failure anywhere under (app) was caught at [locale] — one
 * segment above the console layout — so the sidebar, the navigation and the
 * account menu were unmounted along with the page that failed, and the error
 * panel appeared over nothing at all. ErrorState is written to be a panel over
 * the thing you were doing rather than a page you have arrived at, and that
 * only reads true if the thing you were doing is still behind it.
 *
 * It also decides what Retry means. Caught here, `reset()` re-renders the
 * failed page inside a shell that never went away; caught a level up, it
 * re-renders the whole console.
 */
export default function ConsoleError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState {...props} scope="console" />;
}
