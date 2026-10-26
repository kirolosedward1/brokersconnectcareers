import { ApiError, callAction, getJson, noAnswer } from '~/lib/api';

/*
  What the app's calls to the website make of an answer that is not the
  website's: a 200 whose body is not JSON — a hotel or café Wi-Fi's sign-in
  page standing in for every address until somebody taps "accept", or a body
  cut off on the way. The action may or may not have run, and the website
  said nothing either way: it is no answer, as offline is, so the screens say
  "no connection" and a write asks the database whether it went in.
*/

jest.mock('~/lib/session-storage', () => ({
  encryptedSessionStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

const portalPage = () =>
  new Response('<!doctype html><title>Sign in to the Wi-Fi</title>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

beforeEach(() => {
  globalThis.fetch = jest.fn(async () => portalPage()) as unknown as typeof fetch;
});

describe('a 200 whose body is not the website’s JSON', () => {
  it('is no answer to a read, not a crash with a parser’s error', async () => {
    const failure = await getJson('/api/mobile/v1/browse').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(0);
    expect(noAnswer(failure)).toBe(true);
  });

  it('is no answer to a write either', async () => {
    const failure = await callAction('recordJobView', { slug: 'sales-manager' }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(0);
  });

  it('and a body cut off part-way is the same', async () => {
    globalThis.fetch = jest.fn(
      async () => new Response('{"ok":tr', { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
    const failure = await getJson('/api/mobile/v1/browse').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(0);
  });

  it('while the website’s own JSON is still read as it was', async () => {
    globalThis.fetch = jest.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
    await expect(getJson('/api/mobile/v1/browse')).resolves.toEqual({ ok: true });
  });
});
