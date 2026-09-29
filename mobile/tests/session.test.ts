import type { Session } from '@supabase/supabase-js';
import { authSession, authUser, profile } from './auth-fixtures';

/*
  The session on the phone when the network or the auth server lets it down —
  the real supabase-js client with the app's own options (src/lib/supabase.ts),
  the encrypted store swapped for a Map as elsewhere. Each case loads the
  modules afresh, so no client carries one case's session into the next.
*/

jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: {
    getItem: async (key: string) => (globalThis as unknown as { __store: Map<string, string> }).__store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      (globalThis as unknown as { __store: Map<string, string> }).__store.set(key, value);
    },
    removeItem: async (key: string) => {
      (globalThis as unknown as { __store: Map<string, string> }).__store.delete(key);
    },
  },
}));

const store = () => (globalThis as unknown as { __store: Map<string, string> }).__store;

function fresh() {
  let modules!: {
    supabase: typeof import('~/lib/supabase').supabase;
    SESSION_KEY: string;
    signOutHere: typeof import('~/features/push/device').signOutHere;
    callAction: typeof import('~/lib/api').callAction;
    ApiError: typeof import('~/lib/api').ApiError;
    loadViewer: typeof import('~/lib/session').loadViewer;
  };
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- a fresh copy of each module, per case */
    modules = {
      supabase: require('~/lib/supabase').supabase,
      SESSION_KEY: require('~/lib/supabase').SESSION_KEY,
      signOutHere: require('~/features/push/device').signOutHere,
      callAction: require('~/lib/api').callAction,
      ApiError: require('~/lib/api').ApiError,
      loadViewer: require('~/lib/session').loadViewer,
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  return modules;
}

type Answer = (url: URL, init?: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const offline: Answer = () => {
  throw new TypeError('Network request failed');
};
const sent: { path: string; bearer: string | null }[] = [];

function network(answer: Answer) {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    sent.push({ path: url.pathname, bearer: new Headers(init?.headers).get('authorization') });
    return answer(url, init);
  }) as unknown as typeof fetch;
}

const expired = (): Session =>
  ({ ...authSession(authUser()), expires_at: Math.floor(Date.now() / 1000) - 3600 }) as unknown as Session;

beforeEach(() => {
  (globalThis as unknown as { __store: Map<string, string> }).__store = new Map();
  sent.length = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('signing out', () => {
  it('works offline even once the access token has expired', async () => {
    const { supabase, SESSION_KEY, signOutHere } = fresh();
    store().set(SESSION_KEY, JSON.stringify(expired()));
    network(offline);
    const events: string[] = [];
    supabase.auth.onAuthStateChange((event) => {
      events.push(event);
    });

    const done = signOutHere();
    // supabase-js tries to refresh first, backing off for about half a minute.
    await jest.advanceTimersByTimeAsync(60_000);
    await done;

    expect(store().has(SESSION_KEY)).toBe(false);
    expect(events).toContain('SIGNED_OUT');
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
  });
});

describe('a call the website refuses for its token', () => {
  const refused = (refresh: Answer): Answer => (url, init) => {
    if (url.pathname.startsWith('/api/mobile/v1/actions/')) return json({ error: 'invalid_token' }, 401);
    if (url.pathname === '/auth/v1/token') return refresh(url, init);
    return json({});
  };

  it('keeps the session when the refresh is rate-limited — many phones share one address here', async () => {
    const { SESSION_KEY, callAction, ApiError } = fresh();
    store().set(SESSION_KEY, JSON.stringify(authSession(authUser())));
    network(refused(() => json({ code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, 429)));

    const failure = await callAction('announcePasswordChange').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as InstanceType<typeof ApiError>).status).toBe(429);
    expect(store().has(SESSION_KEY)).toBe(true);
  });

  it('keeps the session at launch when the refresh is rate-limited, once the access token has run out', async () => {
    const { supabase, SESSION_KEY } = fresh();
    // Opened the next morning: the access token expired overnight, and only a refresh can bring it back.
    store().set(SESSION_KEY, JSON.stringify(expired()));
    network(refused(() => json({ code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, 429)));

    const loading = supabase.auth.getSession();
    await jest.advanceTimersByTimeAsync(60_000);
    const { error } = await loading;

    // Not a refusal of the session: kept, and tried again as when offline.
    expect(store().has(SESSION_KEY)).toBe(true);
    expect(error === null || error.name === 'AuthRetryableFetchError').toBe(true);
  });

  it('signs out when the refresh is refused: the session is over', async () => {
    const { SESSION_KEY, callAction } = fresh();
    store().set(SESSION_KEY, JSON.stringify(authSession(authUser())));
    network(
      refused(() => json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400)),
    );

    const failure = await callAction('announcePasswordChange').catch((error: unknown) => error);
    expect((failure as { status: number }).status).toBe(401);
    expect(store().has(SESSION_KEY)).toBe(false);
  });
});

describe('a read while the session cannot be refreshed', () => {
  it('never goes out as nobody, so a signed-in person is not shown a stranger’s empty answers', async () => {
    const { supabase, SESSION_KEY } = fresh();
    store().set(SESSION_KEY, JSON.stringify(expired()));
    // The auth server is failing; the database would answer.
    network((url) => (url.pathname.startsWith('/auth/v1/') ? json({ message: 'upstream unavailable' }, 503) : json([])));

    const read = supabase.from('applications').select('id');
    await jest.advanceTimersByTimeAsync(60_000);
    const { data, error } = await read;

    expect(data).toBeNull();
    expect(error?.message).toMatch(/^TypeError/);
    expect(sent.filter((request) => request.path.startsWith('/rest/v1/'))).toHaveLength(0);
    // Still signed in here: the next refresh brings the session back.
    expect(store().has(SESSION_KEY)).toBe(true);
  });
});

describe('an account with no profile', () => {
  it('is believed only from the auth server; a deleted account is signed out, not sent to onboarding', async () => {
    const { supabase, SESSION_KEY, loadViewer } = fresh();
    const session = authSession(authUser()) as unknown as Session;
    store().set(SESSION_KEY, JSON.stringify(session));
    network((url) => {
      if (url.pathname === '/rest/v1/profiles') return json([]);
      if (url.pathname === '/auth/v1/user') return json({ code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }, 403);
      return json({});
    });

    await expect(loadViewer(session)).rejects.toBeTruthy();
    expect(store().has(SESSION_KEY)).toBe(false);
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
  });

  it('is one when the auth server confirms the account', async () => {
    const { SESSION_KEY, loadViewer } = fresh();
    const session = authSession(authUser()) as unknown as Session;
    store().set(SESSION_KEY, JSON.stringify(session));
    network((url) => {
      if (url.pathname === '/rest/v1/profiles') return json([]);
      if (url.pathname === '/auth/v1/user') return json(authUser());
      return json({});
    });

    const viewer = await loadViewer(session);
    expect(viewer.profile).toBeNull();
    expect(viewer.profileUnreadable).toBe(false);
  });

  it('keeps an established account’s profile', async () => {
    const { SESSION_KEY, loadViewer } = fresh();
    const session = authSession(authUser()) as unknown as Session;
    store().set(SESSION_KEY, JSON.stringify(session));
    network((url) => (url.pathname === '/rest/v1/profiles' ? json([profile]) : json({})));

    expect((await loadViewer(session)).profile?.id).toBe(profile.id);
    expect(sent.some((request) => request.path === '/auth/v1/user')).toBe(false);
  });
});
