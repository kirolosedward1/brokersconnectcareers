import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { utf8Decode, utf8Encode } from './utf8';

/**
 * Where the signed-in session lives on the phone.
 *
 * The Keychain is the right home for a secret and the wrong home for this one:
 * a Supabase session — two tokens and the user object — runs past the couple of
 * kilobytes SecureStore is comfortable with. So the Keychain holds a 256-bit
 * AES key, and app storage holds the session sealed with it (AES-GCM, so a
 * tampered copy fails to open rather than opening wrong).
 *
 * The key is this-device-only. Restored onto a new phone from a backup, the
 * ciphertext comes along and the key does not; the copy cannot be opened, is
 * discarded, and the person signs in again — which is what should happen.
 */
const KEY_NAME = 'bc.session-key.v1';

let keyPromise: Promise<AESEncryptionKey> | null = null;

function sessionKey(): Promise<AESEncryptionKey> {
  keyPromise ??= (async () => {
    const stored = await SecureStore.getItemAsync(KEY_NAME);
    if (stored) return AESEncryptionKey.import(stored, 'base64');

    const fresh = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(KEY_NAME, await fresh.encoded('base64'), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    return fresh;
  })().catch((error: unknown) => {
    // Let the next call try again rather than caching a failure forever.
    keyPromise = null;
    throw error;
  });
  return keyPromise;
}

/** The storage adapter supabase-js is given; its three methods are all it asks for. */
export const encryptedSessionStorage = {
  async getItem(name: string): Promise<string | null> {
    const sealed = await AsyncStorage.getItem(name);
    if (!sealed) return null;
    try {
      const bytes = await aesDecryptAsync(AESSealedData.fromCombined(sealed), await sessionKey(), {
        output: 'bytes',
      });
      return utf8Decode(bytes);
    } catch {
      // Unreadable — sealed with a key this device no longer has. Treated as
      // signed out, and cleared so the next launch does not try again.
      await AsyncStorage.removeItem(name);
      return null;
    }
  },

  async setItem(name: string, value: string): Promise<void> {
    const sealed = await aesEncryptAsync(utf8Encode(value), await sessionKey());
    await AsyncStorage.setItem(name, await sealed.combined('base64'));
  },

  async removeItem(name: string): Promise<void> {
    await AsyncStorage.removeItem(name);
  },
};
