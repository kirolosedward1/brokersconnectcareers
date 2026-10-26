'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  googleInitializeOptions,
  googleOneTapNonce,
  gsiScriptSrc,
  isAppWebView,
  oneTapClosedByVisitor,
  oneTapClosedThisSession,
  rememberOneTapClosed,
  shouldShowGoogleOneTap,
} from '@/lib/auth/google-one-tap';
import { createClient } from '@/lib/supabase/client';
import { useRefreshSession, useSession } from '@/components/session/session-provider';

/**
 * Google One Tap, for a signed-out visitor on the home page, the jobs list
 * or a job's page.
 *
 * The prompt is Google's. This renders nothing of its own and does not pass
 * `prompt_parent_id`, so there is no container to restyle. Closing it is
 * remembered for this tab (`bc.google-one-tap`) and, separately, by Google's
 * own cooldown — that cookie is never cleared here.
 *
 * A successful sign-in stays on this URL. The session cookie is written by
 * the browser client; the header reads it back from /api/chrome, and
 * `router.refresh()` lets the middleware serve the signed-in view of the
 * same address (the feed at `/`, the listing the reader was already on).
 */

const SCRIPT_ID = 'google-gsi-client';

type PromptMoment = {
  isSkippedMoment?: () => boolean;
  getSkippedReason?: () => string;
  isDismissedMoment?: () => boolean;
  getDismissedReason?: () => string;
};

type GoogleId = {
  initialize: (config: ReturnType<typeof googleInitializeOptions>) => void;
  prompt: (moment?: (notification: PromptMoment) => void) => void;
  cancel: () => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
    ReactNativeWebView?: unknown;
  }
}

export function GoogleOneTap({ clientId, locale }: { clientId: string; locale: Locale }) {
  const pathname = usePathname();
  const session = useSession();
  const refreshSession = useRefreshSession();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [webView, setWebView] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [finished, setFinished] = useState(false);
  const generation = useRef(0);
  const nonces = useRef(new Map<number, string>());

  useEffect(() => {
    setWebView(isAppWebView({ userAgent: navigator.userAgent, reactNativeWebView: typeof window.ReactNativeWebView !== 'undefined' }));
    setDismissed(oneTapClosedThisSession());
    setReady(true);
  }, []);

  const onCredential = useCallback(
    async (response: { credential?: string }, issued: number) => {
      const token = response.credential;
      const nonce = nonces.current.get(issued);
      if (!token || !nonce || issued !== generation.current) return;
      const { error } = await createClient().auth.signInWithIdToken({
        provider: 'google',
        token,
        nonce,
      });
      if (error) {
        console.warn('[auth] google one tap failed', error.code ?? error.message);
        return;
      }
      // Before the chrome request answers, so a second prompt cannot open.
      setFinished(true);
      refreshSession();
      router.refresh();
    },
    [refreshSession, router],
  );

  const show =
    ready &&
    !finished &&
    shouldShowGoogleOneTap({
      pathname,
      signedIn: session.kind === 'user',
      sessionPending: session.kind === 'pending',
      dismissedThisSession: dismissed,
      webView,
      googleEnabled: true,
      clientId,
    });

  useEffect(() => {
    if (!show) {
      window.google?.accounts?.id?.cancel();
      return;
    }

    let cancelled = false;
    const issued = ++generation.current;

    const start = () => {
      const google = window.google?.accounts?.id;
      if (cancelled || !google) return;
      void (async () => {
        let pair: Awaited<ReturnType<typeof googleOneTapNonce>>;
        try {
          pair = await googleOneTapNonce();
        } catch {
          // No Web Crypto (a page opened over plain http, or a very old WebView).
          // One Tap needs the nonce, so it does not run.
          return;
        }
        if (cancelled || issued !== generation.current) return;
        nonces.current.set(issued, pair.supabaseNonce);
        try {
          google.initialize(
            googleInitializeOptions({
              clientId,
              googleNonce: pair.googleNonce,
              callback: (response) => {
                void onCredential(response, issued);
              },
            }),
          );
          google.prompt((moment) => {
            if (issued !== generation.current) return;
            if (!oneTapClosedByVisitor(moment)) return;
            rememberOneTapClosed();
            setDismissed(true);
          });
        } catch (error) {
          console.warn('[auth] google one tap could not start', error instanceof Error ? error.message : error);
        }
      })();
    };

    const src = gsiScriptSrc(locale);
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    // `hl` is read when the script loads. If the locale changed before that
    // (the language switch is a client navigation), load the matching URL.
    // Once GIS is on the page its language is already chosen.
    if (script && script.getAttribute('src') !== src && !window.google?.accounts?.id) {
      script.remove();
      script = null;
    }
    if (window.google?.accounts?.id) {
      start();
    } else if (script) {
      script.addEventListener('load', start);
    } else {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = src;
      script.addEventListener('load', start);
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      script?.removeEventListener('load', start);
      window.google?.accounts?.id?.cancel();
    };
  }, [show, clientId, locale, onCredential]);

  return null;
}
