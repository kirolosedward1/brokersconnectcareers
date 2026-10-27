'use client';

import { useEffect } from 'react';
import { FIRST_TOUCH_STORAGE, parseTouch, touchFromCookieHeader } from '@/lib/attribution-cookie';

const SENT = 'bc_touch_sent';

/**
 * Once this browser has an account, copy the first visit onto it.
 *
 * A profile that already existed before the visit was recorded is left
 * unknown by the server. The flag in sessionStorage only stops a second
 * request after the server said the row is settled.
 */
export function RememberFirstTouch() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SENT)) return;
    } catch {
      return;
    }
    const raw = touchFromCookieHeader(document.cookie) ?? parseTouch(safeStore());
    // A POST, not the server action. Calling saveFirstTouch() from this layout
    // races the console's streamed render (loading.tsx) and the app router
    // then throws React's "more hooks than the previous render" on /admin.
    fetch('/api/attribution', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(raw ?? {}),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { ok?: boolean };
        if (result.ok) {
          try {
            sessionStorage.setItem(SENT, '1');
          } catch {
            // The next page will ask once more. The write itself is once.
          }
        }
      })
      .catch(() => {});
  }, []);

  return null;
}

function safeStore(): string | null {
  try {
    return localStorage.getItem(FIRST_TOUCH_STORAGE);
  } catch {
    return null;
  }
}
