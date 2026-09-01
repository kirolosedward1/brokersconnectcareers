'use client';

import { ErrorState } from '@/components/error-state';

/**
 * The auth screens and anything else outside the (site) group. Same treatment,
 * one level up — the header is still above us here, so a reader who lands on
 * this can navigate away without reaching for the back button.
 */
export default function LocaleError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState {...props} scope="locale" />;
}
