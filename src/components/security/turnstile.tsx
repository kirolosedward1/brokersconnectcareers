'use client';

import { useEffect, useId, useRef } from 'react';

/**
 * Cloudflare Turnstile, invisible until it has a reason not to be.
 *
 * Renders nothing at all when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset, so a
 * checkout without Cloudflare configured is the site as it was. With a key,
 * the widget runs in `interaction-only` appearance: Cloudflare's own signals
 * decide whether this browser needs to do anything, and for almost everyone
 * the answer is no and nothing appears. The forms that use it pass the token
 * to Supabase Auth, which verifies it against the secret — so the check is
 * made by the server that acts on it, and a script that skips this page and
 * calls GoTrue directly meets the same wall.
 *
 * `visible` forces the widget on screen — the sign-in form asks for that
 * after repeated failures, which is the one place a person should see it.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          appearance?: 'always' | 'execute' | 'interaction-only';
          size?: 'normal' | 'flexible' | 'compact';
          language?: string;
          action?: string;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

export function turnstileEnabled(): boolean {
  return Boolean(TURNSTILE_SITE_KEY);
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error('turnstile failed to load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function Turnstile({
  onToken,
  action,
  visible = false,
  locale,
  resetKey = 0,
}: {
  /** Called with a fresh token, and with null when one expires. */
  onToken: (token: string | null) => void;
  /** A label Cloudflare shows in its analytics, e.g. 'sign-in'. */
  action: string;
  visible?: boolean;
  locale?: string;
  /** Change it to make the widget produce a new token (after a failed submit). */
  resetKey?: number;
}) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const latest = useRef(onToken);
  latest.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !container.current) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widget.current = window.turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          appearance: visible ? 'always' : 'interaction-only',
          size: 'flexible',
          language: locale,
          callback: (token) => latest.current(token),
          'expired-callback': () => latest.current(null),
          'error-callback': () => latest.current(null),
        });
      })
      .catch(() => {
        // The script did not load — an ad blocker, a network. The form falls
        // back to submitting without a token; Supabase decides what that means.
        latest.current(null);
      });

    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) {
        try {
          window.turnstile.remove(widget.current);
        } catch {
          // Already gone.
        }
      }
      widget.current = null;
    };
    // The widget is rebuilt when visibility changes, which is the only prop
    // Cloudflare cannot change on a live widget.
  }, [action, locale, visible]);

  useEffect(() => {
    if (resetKey > 0 && widget.current && window.turnstile) {
      window.turnstile.reset(widget.current);
    }
  }, [resetKey]);

  if (!TURNSTILE_SITE_KEY) return null;

  return <div id={id} ref={container} className={visible ? 'min-h-16' : undefined} />;
}
