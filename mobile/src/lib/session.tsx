import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Actor } from '@/lib/permissions';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';
import { readLastActor, rememberActor } from './last-actor';
import { supabase } from './supabase';

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
  actor: Actor;
  /**
   * The account has an authenticator and this session has not used it yet
   * (aal1 where aal2 is possible): the code is asked for before anything else.
   */
  secondFactorDue: boolean;
  refreshViewer: () => Promise<Viewer | null>;
};

const SessionContext = createContext<SessionState | null>(null);

export async function loadViewer(session: Session): Promise<Viewer> {
  const user = session.user;
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();

  let company: CompanyRow | null = null;
  if (profile?.role === 'employer' || profile?.role === 'admin') {
    const { data: companyId } = await supabase.rpc('my_company_id');
    if (companyId) {
      const { data } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
      company = (data as CompanyRow | null) ?? null;
    }
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: (profile as ProfileRow | null) ?? null,
    company,
    profileUnreadable: Boolean(error),
  };
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
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    // Local only, so the first frame waits on nothing but the phone's storage.
    readLastActor().then((actor) => {
      if (active) setRemembered((current) => (current.loaded ? current : { loaded: true, actor }));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Someone else's data must not be on screen for a frame after a switch.
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'taxonomy' });
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
    const viewer = session ? (viewerQuery.data ?? null) : null;

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
