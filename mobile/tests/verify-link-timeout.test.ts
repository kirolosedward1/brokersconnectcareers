/* An email link checked on a connection that stalls ends as an error the confirm screen can offer to retry, not "verifying" for good. */
import { checkLink } from '~/features/auth/verify-link';

it('gives up on a stalled link check after its limit', async () => {
  const realFetch = global.fetch;
  // A request that never answers, until its signal gives up on it.
  global.fetch = jest.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new TypeError('Network request failed: aborted')));
      }),
  ) as typeof fetch;
  jest.useFakeTimers();
  try {
    const done = checkLink('signup', 'pkce_abc123abc123abc1');
    await jest.advanceTimersByTimeAsync(21_000);
    const result = await done;
    expect(result.kind).toBe('error');
    expect(global.fetch).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
    global.fetch = realFetch;
  }
});
