const mockDisk = new Map<string, string>();
const mockPlatform = { OS: 'ios' };
const mockAvailable = jest.fn(async () => true);
const mockReadKey = jest.fn(async (): Promise<string | null> => null);
const mockWriteKey = jest.fn(async () => {});
const mockDiskWrite = jest.fn(async (key: string, value: string) => { mockDisk.set(key, value); });
const mockSeal = (value: Uint8Array) => ({ combined: async () => `sealed:${String.fromCharCode(...value)}` });
const mockEncrypt = jest.fn(async (value: Uint8Array) => mockSeal(value));
const mockDecrypt = jest.fn(async (value: string) => {
  if (!value.startsWith('sealed:')) throw new Error('invalid ciphertext');
  return Uint8Array.from(value.slice(7), (c) => c.charCodeAt(0));
});

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return new Proxy(actual, { get: (target, key) => key === 'Platform' ? mockPlatform : Reflect.get(target, key) });
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockDisk.get(key) ?? null,
  setItem: (key: string, value: string) => mockDiskWrite(key, value),
  removeItem: async (key: string) => { mockDisk.delete(key); },
}));
jest.mock('expo-secure-store', () => ({
  isAvailableAsync: () => mockAvailable(),
  getItemAsync: () => mockReadKey(),
  setItemAsync: (...args: unknown[]) => (mockWriteKey as (...args: unknown[]) => Promise<void>)(...args),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
}));
jest.mock('expo-crypto', () => ({
  AESEncryptionKey: {
    generate: async () => ({ encoded: async () => 'device-key' }),
    import: async () => ({}),
  },
  AESSealedData: { fromCombined: (value: string) => value },
  aesEncryptAsync: (value: Uint8Array) => mockEncrypt(value),
  aesDecryptAsync: (value: string) => mockDecrypt(value),
}));

const KEY = 'bc.session-key.v1';
const SESSION = 'test-session';
const load = async () => {
  let storage!: typeof import('~/lib/session-storage').encryptedSessionStorage;
  jest.isolateModules(() => {
    storage = jest.requireActual('~/lib/session-storage').encryptedSessionStorage;
  });
  return storage;
};

beforeEach(() => {
  mockDisk.clear();
  mockPlatform.OS = 'ios';
  mockAvailable.mockReset().mockResolvedValue(true);
  mockReadKey.mockReset().mockResolvedValue(null);
  mockWriteKey.mockReset().mockResolvedValue(undefined);
  mockEncrypt.mockClear();
  mockDecrypt.mockClear();
  mockDiskWrite.mockClear();
});

it('stores native keys only in device-only SecureStore', async () => {
  const storage = await load();
  await storage.setItem(SESSION, 'token');
  expect(mockWriteKey).toHaveBeenCalledWith(KEY, 'device-key', { keychainAccessible: 1 });
  expect(mockDisk.has(KEY)).toBe(false);
  expect(mockDisk.get(SESSION)).not.toBe('token');
  expect(await storage.getItem(SESSION)).toBe('token');
});

it.each(['ios', 'android'])('never falls back to ordinary storage on %s', async (os) => {
  mockPlatform.OS = os;
  mockAvailable.mockResolvedValue(false);
  const storage = await load();
  await expect(storage.setItem(SESSION, 'token')).rejects.toThrow();
  expect(mockDisk.has(KEY)).toBe(false);
  expect(mockDisk.has(SESSION)).toBe(false);
  expect(await storage.getItem(SESSION)).toBeNull();
});

it('preserves sealed sessions across temporary SecureStore failures and retries', async () => {
  mockDisk.set(SESSION, 'sealed:existing-token');
  mockAvailable.mockRejectedValueOnce(new Error('temporarily unavailable'));
  const storage = await load();
  expect(await storage.getItem(SESSION)).toBeNull();
  expect(mockDisk.get(SESSION)).toBe('sealed:existing-token');
  expect(await storage.getItem(SESSION)).toBe('existing-token');
  expect(mockDisk.has(KEY)).toBe(false);
});

it('removes legacy native plaintext keys without using them', async () => {
  mockDisk.set(KEY, 'old-unprotected-key');
  const storage = await load();
  await storage.setItem(SESSION, 'new-session');
  expect(mockDisk.has(KEY)).toBe(false);
  expect(mockWriteKey).toHaveBeenCalled();
});

it('keeps the explicit web fallback without calling SecureStore', async () => {
  mockPlatform.OS = 'web';
  const storage = await load();
  await storage.setItem(SESSION, 'token');
  expect(mockAvailable).not.toHaveBeenCalled();
  expect(mockWriteKey).not.toHaveBeenCalled();
  expect(mockDisk.get(KEY)).toBe('device-key');
  expect(await storage.getItem(SESSION)).toBe('token');
});

it('does not cache a session whose persistence failed and recovers on retry', async () => {
  mockDiskWrite.mockRejectedValueOnce(new Error('disk full'));
  const storage = await load();
  await expect(storage.setItem(SESSION, 'not-saved')).rejects.toThrow('disk full');
  expect(await storage.getItem(SESSION)).toBeNull();
  await storage.setItem(SESSION, 'saved');
  expect(await storage.getItem(SESSION)).toBe('saved');
});

it('finishes a pending encrypted write before sign-out removes it', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const began = new Promise<void>((resolve) => { started = resolve; });
  mockEncrypt.mockImplementationOnce(async (value) => { started(); await gate; return mockSeal(value); });
  const storage = await load();
  const write = storage.setItem(SESSION, 'token');
  await began;
  const remove = storage.removeItem(SESSION);
  release();
  await Promise.all([write, remove]);
  expect(mockDisk.has(SESSION)).toBe(false);
  expect(await storage.getItem(SESSION)).toBeNull();
});

it('does not let a late decryption restore the cache after sign-out', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const began = new Promise<void>((resolve) => { started = resolve; });
  mockDisk.set(SESSION, 'sealed:token');
  mockDecrypt.mockImplementationOnce(async () => { started(); await gate; return new Uint8Array([116]); });
  const storage = await load();
  const read = storage.getItem(SESSION);
  await began;
  const remove = storage.removeItem(SESSION);
  release();
  await Promise.all([read, remove]);
  expect(mockDisk.has(SESSION)).toBe(false);
  expect(await storage.getItem(SESSION)).toBeNull();
});

it('discards damaged ciphertext', async () => {
  mockDisk.set(SESSION, 'damaged');
  const storage = await load();
  expect(await storage.getItem(SESSION)).toBeNull();
  expect(mockDisk.has(SESSION)).toBe(false);
});
