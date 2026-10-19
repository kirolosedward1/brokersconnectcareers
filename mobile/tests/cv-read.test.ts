/*
  Reading a picked CV: expo-file-system's File first, the legacy base64 read
  when that fails (as it can in Expo Go), and both failing said with why.
*/
const mockArrayBuffer = jest.fn<Promise<ArrayBuffer>, []>();
const mockReadAsString = jest.fn<Promise<string>, [string, unknown]>();

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ arrayBuffer: mockArrayBuffer })),
}));
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: (uri: string, options: unknown) => mockReadAsString(uri, options),
  EncodingType: { Base64: 'base64' },
}));
jest.mock('~/lib/supabase', () => ({ supabase: {} }));

import { base64ToBytes, CvUploadFailed, readCvBytes } from '~/features/cv/files';

const text = (buffer: ArrayBuffer) => String.fromCharCode(...new Uint8Array(buffer));
const utf8 = (value: string) => new TextEncoder().encode(value);
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

beforeEach(() => {
  mockArrayBuffer.mockReset();
  mockReadAsString.mockReset();
});

describe('base64ToBytes', () => {
  it.each(['', 'a', 'ab', 'abc', '%PDF-1.7\n', 'كلام'])('decodes what btoa encodes: %j', (value) => {
    const bytes = utf8(value);
    expect([...base64ToBytes(toBase64(bytes))]).toEqual([...bytes]);
  });

  it('ignores line breaks in the text', () => {
    expect(new TextDecoder().decode(base64ToBytes('JVBE\nRi0x\r\nLjc='))).toBe('%PDF-1.7');
  });
});

describe('readCvBytes', () => {
  it('uses the File API when it works', async () => {
    mockArrayBuffer.mockResolvedValue(new TextEncoder().encode('%PDF').buffer as ArrayBuffer);
    expect(text(await readCvBytes('file:///cv.pdf'))).toBe('%PDF');
    expect(mockReadAsString).not.toHaveBeenCalled();
  });

  it('falls back to the legacy base64 read when the File API throws', async () => {
    mockArrayBuffer.mockRejectedValue(new Error('Cannot find native module'));
    mockReadAsString.mockResolvedValue(btoa('%PDF-1.7'));
    expect(text(await readCvBytes('file:///cv.pdf'))).toBe('%PDF-1.7');
  });

  it('falls back when the File API reads nothing', async () => {
    mockArrayBuffer.mockResolvedValue(new ArrayBuffer(0));
    mockReadAsString.mockResolvedValue(btoa('doc'));
    expect(text(await readCvBytes('file:///cv.docx'))).toBe('doc');
  });

  it('says both reasons when neither read works', async () => {
    mockArrayBuffer.mockRejectedValue(new Error('first'));
    mockReadAsString.mockRejectedValue(new Error('second'));
    const failure = await readCvBytes('file:///cv.pdf').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CvUploadFailed);
    expect((failure as CvUploadFailed).reason).toBe('upload');
    expect((failure as CvUploadFailed).detail).toContain('first');
    expect((failure as CvUploadFailed).detail).toContain('second');
  });
});
