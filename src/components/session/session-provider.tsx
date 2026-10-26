'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';

/**
 * Who is reading, learned in the browser.
 *
 * The public pages are cached. A server render that called cookies() to draw
 * the header would make every one of them `no-store`, and a cache that
 * included a name would show one person's account to the next. The HTML is
 * always the signed-out chrome. When a session cookie is present this flips
 * before paint, then fills in from /api/chrome.
 */
export type SessionState =
  | { kind: 'anon' }
  | { kind: 'pending' }
  | {
      kind: 'user';
      hasProfile: boolean;
      name: string;
      avatarUrl: string | null;
      role: string | null;
      homeHref: string;
      postJobHref: string | null;
      showAgents: boolean;
      asksToAgree: boolean;
      unread: number;
      /** An active push device: this person has the app, and allowed notifications. */
      hasApp: boolean;
    };

const SessionContext = createContext<SessionState>({ kind: 'anon' });
const SessionRefreshContext = createContext<() => void>(() => {});

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/**
 * Read /api/chrome again. One Tap calls this after a sign-in that did not
 * navigate, so the header swaps to the account cluster on the same page.
 */
export function useRefreshSession(): () => void {
  return useContext(SessionRefreshContext);
}

export function hasAuthCookie(): boolean {
  return document.cookie.includes('auth-token');
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ kind: 'anon' });
  const cancelLoad = useRef<(() => void) | null>(null);

  const load = useCallback(() => {
    cancelLoad.current?.();
    let cancel = false;
    cancelLoad.current = () => {
      cancel = true;
    };
    fetch('/api/chrome', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { signedIn: false }))
      .then((data: ChromePayload) => {
        if (!cancel) setState(data?.signedIn ? toUser(data) : { kind: 'anon' });
      })
      .catch(() => {
        if (!cancel) setState({ kind: 'anon' });
      });
  }, []);

  const refresh = useCallback(() => {
    setState({ kind: 'pending' });
    load();
  }, [load]);

  useLayoutEffect(() => {
    if (!hasAuthCookie()) return;
    setState({ kind: 'pending' });
    load();
    return () => cancelLoad.current?.();
  }, [load]);

  return (
    <SessionRefreshContext.Provider value={refresh}>
      <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
    </SessionRefreshContext.Provider>
  );
}

type ChromePayload = {
  signedIn?: boolean;
  hasProfile?: boolean;
  name?: string;
  avatarUrl?: string | null;
  role?: string | null;
  homeHref?: string;
  postJobHref?: string | null;
  showAgents?: boolean;
  asksToAgree?: boolean;
  unread?: number;
  hasApp?: boolean;
};

function toUser(data: ChromePayload): SessionState {
  return {
    kind: 'user',
    hasProfile: Boolean(data.hasProfile),
    name: data.name ?? '',
    avatarUrl: data.avatarUrl ?? null,
    role: data.role ?? null,
    homeHref: data.homeHref ?? '/onboarding',
    postJobHref: data.postJobHref ?? null,
    showAgents: Boolean(data.showAgents),
    asksToAgree: Boolean(data.asksToAgree),
    unread: data.unread ?? 0,
    hasApp: Boolean(data.hasApp),
  };
}
