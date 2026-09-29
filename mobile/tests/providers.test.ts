import * as AppleAuthentication from 'expo-apple-authentication';
import { appleAvailable } from '~/features/auth/providers';

/*
  Sign in with Apple in Expo Go: the phone offers it, but Apple issues the
  token to Expo Go's own bundle id and Supabase refuses it, so the app does not
  show the button there.
*/

const mockEnvironment = { current: 'storeClient' };
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  // A getter defined after the copy: in an object literal, the transform would
  // read it once, before mockEnvironment exists.
  const constants = { ...actual.default };
  Object.defineProperty(constants, 'executionEnvironment', { get: () => mockEnvironment.current, enumerable: true });
  return { ...actual, __esModule: true, default: constants };
});

beforeEach(() => {
  jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
});

it('is not offered in Expo Go', async () => {
  mockEnvironment.current = 'storeClient';
  await expect(appleAvailable()).resolves.toBe(false);
});

it('is offered in the app itself, where the phone has it', async () => {
  mockEnvironment.current = 'standalone';
  await expect(appleAvailable()).resolves.toBe(true);
});
