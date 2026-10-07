'use client';

import { ErrorState } from '@/components/error-state';

/**
 * The auth screens and anything else outside the (site) group. Same treatment,
 * one level up — the header is still above us here, so a reader who lands on
 * this can navigate away without reaching for the back button.
 *
 * In its own <main>: the layout's skip link points at #main, and whatever
 * drew one is what failed, so without this it pointed at nothing.
 */
export default function LocaleError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" tabIndex={-1}>
      <ErrorState {...props} scope="locale" />
    </main>
  );
}
