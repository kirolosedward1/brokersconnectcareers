import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError, type Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Actor } from '@/lib/permissions';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';
import { readLastActor, rememberActor } from './last-actor';
import { encryptedSessionStorage } from './session-storage';
import { SESSION_KEY, supabase } from './supabase';

/**
 * Who is using the app — the website's getViewer(), on the phone.
 *
 * Same rules, same order: a session from Supabase Auth; the profile row, whose
 * absence means "has not onboarded"; and for an employer (or an admin who runs
 * one) the company `my_company_id()` names, which is membership rather than
 * ownership so an invited recruiter has one too. A profile that could not be
 * read is kept apart from one that does not exist, as the website does:
 * a database blip must not send an established account back through
 * onboarding.
 *
 * `actor` is the slice src/lib/permissions.ts reads, so every show-or-hide and
 * every redirect in the app is the website's own decision. Until the profile
 * has been read — at launch, or offline, when it cannot be — it is the last
 * answer this phone had for the same account (last-actor.ts), so the tab bar a
 * returning candidate sees does not start as a stranger's.
 */
export type Viewer = {
  userId: string;
  email: string | null;
  profile: ProfileRow | null;
  company: CompanyRow | null;
  profileUnreadable: boolean;
};

type SessionState = {
  /** false until the stored session has been read — draw nothing that depends on it before then. */
  ready: boolean;
  /**
   * The last known account on this phone has been read, so `actor` is as good
   * as it gets before the network answers: the tab bar can be drawn.
   */
  settled: boolean;
  session: Session | null;
  viewer: Viewer | null;
  viewerLoading: boolean;
  /** Why the viewer is unreadable, when it is: offline reads as offline. */
  viewerError: unknown;
  actor: Actor;
  /**
   * The account has an authenticator and this session has not used it yet
   * (aal1 where aal2 is possible): the code is asked for before anything else.
   */
  secondFactorDue: boolean;
  refreshViewer: () => Promise<Viewer | null>;
};

const SessionContext = createContext<SessionState | null>(null);

/**
 * Throws when any part could not be read. A read that failed is not "no
 * profile" or "no company": answered as those, it sent an employer whose
 * company call dropped to the create-company form, and a failed re-read in the
 * background swapped a half-typed form for the loading screen. Thrown, the
 * query keeps the last good answer, and only a first read with nothing to keep
 * becomes the unreadable viewer (below).
 */
export async function loadViewer(session: Session): Promise<Viewer> {
  const user = session.user;
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;

  if (!profile) {
    // "No profile" sends somebody to onboarding, so it is believed only from
    // the auth server: the account is there, and this is its session. A
    // deleted account's token outlives it; so it is signed out here.
    const { data: checked, error: userError } = await supabase.auth.getUser();
    if (isAuthSessionMissingError(userError) || (isAuthApiError(userError) && [401, 403].includes(userError.status ?? 0))) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
    if (userError) throw userError;
    if (checked.user?.id !== user.id) throw new Error('the session changed while the account was read');
  }

  let company: CompanyRow | null = null;
  if (profile?.role === 'employer' || profile?.role === 'admin') {
    const { data: companyId, error: membershipError } = await supabase.rpc('my_company_id');
    if (membershipError) throw membershipError;
    if (companyId) {
      const { data, error: companyError } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
      if (companyError) throw companyError;
      company = (data as CompanyRow | null) ?? null;
    }
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: (profile as ProfileRow | null) ?? null,
    company,
    profileUnreadable: false,
  };
}

/** The viewer for a session whose first read failed: kept apart from one with no profile, as the website does. */
function unreadableViewer(session: Session): Viewer {
  return { userId: session.user.id, email: session.user.email ?? null, profile: null, company: null, profileUnreadable: true };
}

/**
 * The viewer for the session as it is now, read afresh — for the moment right
 * after a sign-in, when the provider's own query is still keyed on the
 * account before it. Null when nobody is signed in.
 */
export async function fetchViewer(queryClient: QueryClient): Promise<Viewer | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  return queryClient.fetchQuery({
    queryKey: ['viewer', session.user.id],
    queryFn: () => loadViewer(session),
    staleTime: 0,
  });
}

/** The permissions slice of a viewer. */
export function actorOf(viewer: Viewer): Actor {
  return {
    userId: viewer.userId,
    profile: viewer.profile ? { role: viewer.profile.role, approval_status: viewer.profile.approval_status } : null,
    company: viewer.company ? { id: viewer.company.id, verification_status: viewer.company.verification_status } : null,
  };
}

/**
 * The session as stored on this phone, read without the network: whether
 * somebody is signed in here is known at once, even when their access token
 * has expired and cannot be refreshed yet (offline at launch, after an hour
 * away), which supabase-js's own answer waits on for up to half a minute.
 */
async function storedSession(): Promise<Session | null> {
  const raw = await encryptedSessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    return parsed?.user?.id ? parsed : null;
  } catch {
    return null;
  }
}

/** aal1 on an account that could prove aal2. Read from the session's own token; no request. */
export async function secondFactorDue(): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === 'aal1' && data.nextLevel === 'aal2';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  const [remembered, setRemembered] = useState<{ loaded: boolean; actor: Actor }>({ loaded: false, actor: null });

  useEffect(() => {
    let active = true;
    // Whose data the cache holds, so that only a different person signing in clears it.
    let lastUser: string | null = null;
    // Who is signed in here, from the phone's own storage: the app is ready at
    // once, and stays signed in while supabase-js tries to refresh.
    storedSession().then((stored) => {
      if (!active || !stored) return;
      lastUser = lastUser ?? stored.user.id;
      setSession((current) => current ?? stored);
      setReady(true);
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        // Not answered is not signed out: a refresh that could not reach the
        // auth server keeps the stored session, and the next refresh (every
        // half minute in the foreground) brings a usable one.
        if (data.session || !isAuthRetryableFetchError(error)) setSession(data.session);
        setReady(true);
      })
      // The session storage failing is no reason to wait forever.
      .catch(() => {
        if (active) setReady(true);
      });
    // Local only, so the first frame waits on nothing but the phone's storage.
    readLastActor().then((actor) => {
      if (active) setRemembered((current) => (current.loaded ? current : { loaded: true, actor }));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      // The first answer is getSession's, above: an INITIAL_SESSION without a
      // session is the same failed refresh, not a sign-out.
      if (event === 'INITIAL_SESSION') {
        if (next) setSession(next);
        lastUser = next?.user.id ?? lastUser;
        return;
      }
      setSession(next);
      // Someone else's data must not be on screen for a frame after a switch —
      // a switch, not the same person signing in again. A reset link opened
      // for another account switches too, with an event of its own.
      const nextUser = next?.user.id ?? null;
      const arrived = event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY';
      if (event === 'SIGNED_OUT' || (arrived && nextUser !== lastUser)) {
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'taxonomy' });
      }
      lastUser = nextUser;
      // A usable token again: whatever failed while there was none is read again.
      if (event === 'TOKEN_REFRESHED' || arrived) {
        queryClient.invalidateQueries({ predicate: (query) => query.state.status === 'error' });
      }
      if (event === 'SIGNED_OUT') {
        setRemembered({ loaded: true, actor: null });
        rememberActor(null);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [queryClient]);

  // Answered per token, so a new session never shows the last one's answer.
  const token = session?.access_token ?? null;
  const [factor, setFactor] = useState<{ token: string; due: boolean } | null>(null);
  useEffect(() => {
    if (!token) return;
    let active = true;
    secondFactorDue()
      .then((due) => {
        if (active) setFactor({ token, due });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [token]);
  const factorDue = factor !== null && factor.token === token && factor.due;

  const userId = session?.user.id ?? null;
  const viewerQuery = useQuery({
    queryKey: ['viewer', userId],
    queryFn: () => loadViewer(session as Session),
    enabled: Boolean(session),
    staleTime: 60_000,
  });

  // Each profile read is the answer the next launch starts from.
  const known = session && viewerQuery.data && !viewerQuery.data.profileUnreadable ? viewerQuery.data : null;
  useEffect(() => {
    if (known) rememberActor(actorOf(known));
  }, [known]);

  const value = useMemo<SessionState>(() => {
    // A failed re-read keeps the last answer (TanStack keeps `data` beside the error).
    const viewer = session
      ? (viewerQuery.data ?? (viewerQuery.isError ? unreadableViewer(session) : null))
      : null;

    let actor: Actor = null;
    if (viewer && !viewer.profileUnreadable) {
      actor = actorOf(viewer);
    } else if (!ready || session) {
      // Not read yet, or not readable: the last answer for the same account.
      const last = remembered.actor;
      if (last && (!session || last.userId === session.user.id)) actor = last;
      else if (viewer) actor = actorOf(viewer);
    }

    return {
      ready,
      settled: remembered.loaded,
      session,
      viewer,
      viewerLoading: Boolean(session) && viewerQuery.isPending,
      viewerError: viewer?.profileUnreadable ? viewerQuery.error : null,
      actor,
      secondFactorDue: Boolean(session) && factorDue,
      refreshViewer: () => fetchViewer(queryClient),
    };
  }, [ready, remembered, session, viewerQuery, factorDue, queryClient]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
