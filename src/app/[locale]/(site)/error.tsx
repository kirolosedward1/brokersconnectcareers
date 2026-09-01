'use client';

import { ErrorState } from '@/components/error-state';

/**
 * What a reader sees when a page in this group throws.
 *
 * Without this file Next serves its own fallback — a white page reading
 * "Application error: a server-side exception has occurred" and a digest
 * number, in English, left-to-right, with no header, no footer and no way
 * onward. Production spent a day looking exactly like that.
 */
export default function SiteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState {...props} scope="site" />;
}
