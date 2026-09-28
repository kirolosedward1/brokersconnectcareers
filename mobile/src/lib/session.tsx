import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Actor } from '@/lib/permissions';
import type { CompanyRow, ProfileRow } from '@/lib/supabase/database.types';
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
 * every redirect in the app is the website's own decision.
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
  session: Session | null;
  viewer: Viewer | null;
  viewerLoading: boolean;
  actor: Actor;
  refreshViewer: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

async function loadViewer(session: Session): Promise<Viewer> {
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Someone else's data must not be on screen for a frame after a switch.
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'taxonomy' });
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [queryClient]);

  const userId = session?.user.id ?? null;
  const viewerQuery = useQuery({
    queryKey: ['viewer', userId],
    queryFn: () => loadViewer(session as Session),
    enabled: Boolean(session),
    staleTime: 60_000,
  });

  const value = useMemo<SessionState>(() => {
    const viewer = session ? (viewerQuery.data ?? null) : null;
    const actor: Actor = viewer
      ? {
          userId: viewer.userId,
          profile: viewer.profile
            ? { role: viewer.profile.role, approval_status: viewer.profile.approval_status }
            : null,
          company: viewer.company
            ? { id: viewer.company.id, verification_status: viewer.company.verification_status }
            : null,
        }
      : null;

    return {
      ready,
      session,
      viewer,
      viewerLoading: Boolean(session) && viewerQuery.isPending,
      actor,
      refreshViewer: async () => {
        await viewerQuery.refetch();
      },
    };
  }, [ready, session, viewerQuery]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
