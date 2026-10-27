'use client';

import { useEffect } from 'react';
import { isAppWebView, cookieHidesAppPromo } from '@/lib/app-view';
import type { RawTouch } from '@/lib/attribution';
import {
  FIRST_TOUCH_STORAGE,
  parseTouch,
  serialiseTouch,
  touchCookieAssignment,
  touchFromCookieHeader,
} from '@/lib/attribution-cookie';

/**
 * Remember the first page this browser opened, and never a later one.
 *
 * Runs once, renders nothing. The cookie is what the server reads at sign-up;
 * localStorage is the copy that survives if the cookie is cleared in between,
 * and it is not allowed to invent a new visit either.
 */
export function FirstTouchCapture() {
  useEffect(() => {
    try {
      const fromCookie = touchFromCookieHeader(document.cookie);
      const fromStore = parseTouch(localStorage.getItem(FIRST_TOUCH_STORAGE));
      const existing = fromCookie ?? fromStore;
      if (existing) {
        if (!fromCookie) {
          const assignment = touchCookieAssignment(existing, location.protocol === 'https:');
          if (assignment) document.cookie = assignment;
        }
        if (!fromStore) {
          const serialised = serialiseTouch(existing);
          if (serialised) localStorage.setItem(FIRST_TOUCH_STORAGE, serialised);
        }
        return;
      }

      const params = new URLSearchParams(location.search);
      const inApp =
        isAppWebView({
          userAgent: navigator.userAgent,
          reactNativeWebView: typeof window !== 'undefined' && 'ReactNativeWebView' in window,
        }) || cookieHidesAppPromo(document.cookie);
      const raw: RawTouch = {
        referrer: inApp ? null : document.referrer || null,
        utmSource: inApp ? null : params.get('utm_source'),
        utmMedium: inApp ? null : params.get('utm_medium'),
        utmCampaign: inApp ? null : params.get('utm_campaign'),
        gclid: inApp ? false : params.has('gclid'),
        fbclid: inApp ? false : params.has('fbclid'),
        landingPath: `${location.pathname}`,
        inApp,
        seenAt: new Date().toISOString(),
      };
      const serialised = serialiseTouch(raw);
      if (!serialised) return;
      localStorage.setItem(FIRST_TOUCH_STORAGE, serialised);
      const assignment = touchCookieAssignment(raw, location.protocol === 'https:');
      if (assignment) document.cookie = assignment;
    } catch {
      // Private mode, or storage turned off. The visit stays unknown.
    }
  }, []);

  return null;
}
