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
 *
 * What was read or written is kept in memory too. supabase-js reads the
 * session before every request, and each read was a storage read, an AES
 * decryption and a parse; nothing but this process writes these keys.
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

const memory = new Map<string, string | null>();

async function readSealed(name: string): Promise<string | null> {
  const sealed = await AsyncStorage.getItem(name);
  if (!sealed) return null;
  // The Keychain not answering this once is not a copy that cannot be opened:
  // nothing is discarded, and the next read tries again.
  const key = await sessionKey();
  try {
    const bytes = await aesDecryptAsync(AESSealedData.fromCombined(sealed), key, { output: 'bytes' });
    return utf8Decode(bytes);
  } catch {
    // Unreadable — sealed with a key this device no longer has. Treated as
    // signed out, and cleared so the next launch does not try again.
    await AsyncStorage.removeItem(name);
    return null;
  }
}

/** The storage adapter supabase-js is given; its three methods are all it asks for. */
export const encryptedSessionStorage = {
  async getItem(name: string): Promise<string | null> {
    if (memory.has(name)) return memory.get(name) ?? null;
    let value: string | null;
    try {
      value = await readSealed(name);
    } catch {
      // Storage or the Keychain failed to answer: nothing to go on this time,
      // and nothing remembered or thrown away — supabase-js rethrows a
      // storage error, which left the app waiting for an answer forever.
      return null;
    }
    memory.set(name, value);
    return value;
  },

  async setItem(name: string, value: string): Promise<void> {
    memory.set(name, value);
    const sealed = await aesEncryptAsync(utf8Encode(value), await sessionKey());
    await AsyncStorage.setItem(name, await sealed.combined('base64'));
  },

  async removeItem(name: string): Promise<void> {
    memory.set(name, null);
    await AsyncStorage.removeItem(name);
  },
};
