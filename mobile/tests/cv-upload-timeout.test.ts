/*
  The CV's upload when supabase-js never answers: the session (a refresh in
  flight) or the storage request itself. Each is said as a failure naming the
  step, where the apply button used to spin for good.
*/
const mockGetSession = jest.fn();
const mockUpload = jest.fn();

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ arrayBuffer: async () => new TextEncoder().encode('%PDF').buffer })),
}));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));
jest.mock('~/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    storage: { from: () => ({ upload: (...args: unknown[]) => mockUpload(...args) }) },
  },
}));

import { CvUploadFailed, uploadCv } from '~/features/cv/files';

const cv = { uri: 'file:///cv.pdf', name: 'Vabali_Spa_Berlin_15.10.2026_12.13.pdf', type: 'application/pdf' };
const signedIn = { data: { session: { access_token: 't' } } };

beforeEach(() => {
  jest.useFakeTimers();
  mockGetSession.mockReset();
  mockUpload.mockReset();
});
afterEach(() => jest.useRealTimers());

async function settle(pending: Promise<unknown>, ms: number) {
  const done = pending.catch((error: unknown) => error);
  await jest.advanceTimersByTimeAsync(ms);
  return done;
}

it('uploads to the candidate folder with the type', async () => {
  mockGetSession.mockResolvedValue(signedIn);
  mockUpload.mockResolvedValue({ error: null });
  const path = await uploadCv('user-1', cv);
  expect(path).toMatch(/^user-1\/[0-9a-f-]+\.pdf$/);
  expect(mockUpload).toHaveBeenCalledWith(path, expect.any(ArrayBuffer), { upsert: false, contentType: 'application/pdf' });
});

it('a session that never answers fails within the limit, naming it', async () => {
  mockGetSession.mockReturnValue(new Promise(() => {}));
  const failure = (await settle(uploadCv('user-1', cv), 16_000)) as CvUploadFailed;
  expect(failure).toBeInstanceOf(CvUploadFailed);
  expect(failure.detail).toContain('the session');
  expect(mockUpload).not.toHaveBeenCalled();
});

it('an upload that never answers fails within the limit, naming it', async () => {
  mockGetSession.mockResolvedValue(signedIn);
  mockUpload.mockReturnValue(new Promise(() => {}));
  const failure = (await settle(uploadCv('user-1', cv), 61_000)) as CvUploadFailed;
  expect(failure).toBeInstanceOf(CvUploadFailed);
  expect(failure.detail).toContain('the upload');
});

it('no session on the phone is said, not sent as a stranger', async () => {
  mockGetSession.mockResolvedValue({ data: { session: null } });
  const failure = (await settle(uploadCv('user-1', cv), 0)) as CvUploadFailed;
  expect(failure.detail).toContain('not signed in');
});

it('storage refusing says its own message', async () => {
  mockGetSession.mockResolvedValue(signedIn);
  mockUpload.mockResolvedValue({ error: new Error('new row violates row-level security policy') });
  const failure = (await settle(uploadCv('user-1', cv), 0)) as CvUploadFailed;
  expect(failure.detail).toContain('row-level security');
});
