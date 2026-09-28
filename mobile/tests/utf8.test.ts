import { utf8Decode, utf8Encode } from '~/lib/utf8';

describe('utf8', () => {
  it.each([
    ['ascii', '{"access_token":"abc.def"}'],
    ['arabic', 'أهلاً بروكرز كونكت'],
    ['isolates and emoji', '⁦٧٠٠٠⁩ – 😀'],
    ['empty', ''],
  ])('round-trips %s', (_name, text) => {
    const bytes = utf8Encode(text);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(utf8Decode(bytes)).toBe(text);
  });

  it('writes the bytes TextEncoder writes', () => {
    const text = 'بيع أول — New Cairo';
    expect(Array.from(utf8Encode(text))).toEqual(Array.from(new TextEncoder().encode(text)));
  });
});
