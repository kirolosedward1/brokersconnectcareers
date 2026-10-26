'use client';

import { createContext, useContext, useLayoutEffect, useState } from 'react';

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

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export function hasAuthCookie(): boolean {
  return document.cookie.includes('auth-token');
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ kind: 'anon' });

  useLayoutEffect(() => {
    if (!hasAuthCookie()) return;
    setState({ kind: 'pending' });
    let cancel = false;
    fetch('/api/chrome', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { signedIn: false }))
      .then((data: ChromePayload) => {
        if (cancel) return;
        setState(data?.signedIn ? toUser(data) : { kind: 'anon' });
      })
      .catch(() => {
        if (!cancel) setState({ kind: 'anon' });
      });
    return () => {
      cancel = true;
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
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
