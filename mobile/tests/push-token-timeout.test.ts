/* A push token that never comes is said as a failure, not a switch spinning for good. */
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  setNotificationHandler: jest.fn(),
  getExpoPushTokenAsync: () => new Promise(() => {}),
}));
jest.mock('~/lib/supabase', () => ({ supabase: { rpc: jest.fn() }, SESSION_KEY: 'k' }));

import { registerThisPhone } from '~/features/push/device';
import { TimedOut } from '~/lib/timeout';

it('gives up on the push token after its limit', async () => {
  jest.useFakeTimers();
  try {
    const done = registerThisPhone('ar').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(16_000);
    const failure = await done;
    expect(failure).toBeInstanceOf(TimedOut);
    expect((failure as TimedOut).step).toBe('the push token');
  } finally {
    jest.useRealTimers();
  }
});

it('shares one registration between asks made while it is on its way', () => {
  const first = registerThisPhone('ar');
  const second = registerThisPhone('ar');
  expect(second).toBe(first);
  first.catch(() => {});
});
