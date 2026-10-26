import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { encryptedSessionStorage } from '~/lib/session-storage';

const mockGetItemAsync = jest.fn(async (_key: string) => null as string | null);
const mockSetItemAsync = jest.fn(async (_key: string, _value: string) => {});
const mockIsAvailableAsync = jest.fn(async () => true);

jest.mock('expo-secure-store', () => ({
  getItemAsync: (key: string) => mockGetItemAsync(key),
  setItemAsync: (key: string, value: string) => mockSetItemAsync(key, value),
  isAvailableAsync: () => mockIsAvailableAsync(),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
}));

// Jest's expo-crypto build has no AES key methods. The web path only needs
// a key that can be stored and a seal that can be written beside it.
jest.mock('expo-crypto', () => {
  const actual = jest.requireActual('expo-crypto');
  class Key {
    static async generate() {
      return new Key();
    }
    static async import() {
      return new Key();
    }
    async encoded() {
      return 'dGVzdC1rZXk=';
    }
  }
  return {
    ...actual,
    AESEncryptionKey: Key,
    AESSealedData: { fromCombined: (value: string) => value },
    aesEncryptAsync: async () => ({ combined: async () => 'c2VhbGVk' }),
    aesDecryptAsync: async () => new Uint8Array(),
  };
});

const originalOs = Platform.OS;

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOs });
  mockGetItemAsync.mockClear();
  mockSetItemAsync.mockClear();
});

describe('the session key on the web', () => {
  it('does not call SecureStore, and the session still round-trips', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    await encryptedSessionStorage.setItem('session', '{"access_token":"abc"}');
    expect(mockGetItemAsync).not.toHaveBeenCalled();
    expect(mockSetItemAsync).not.toHaveBeenCalled();
    await expect(encryptedSessionStorage.getItem('session')).resolves.toBe('{"access_token":"abc"}');
    // The key went to app storage, beside the sealed session.
    expect(await AsyncStorage.getItem('bc.session-key.v1')).toEqual(expect.any(String));
  });
});
