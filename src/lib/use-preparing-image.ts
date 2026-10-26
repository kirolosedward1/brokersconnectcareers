'use client';

import { useEffect, useState } from 'react';
import { PREPARING_IMAGE_AFTER_MS } from '@/lib/image-upload';

/**
 * Whether a conversion has been running long enough to say so.
 *
 * The status line starts as the ordinary "one moment". This becomes true
 * about three seconds later, and is false again the moment the conversion
 * ends — including when it fails.
 */
export function usePreparingImage(active: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), PREPARING_IMAGE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
  return slow;
}
