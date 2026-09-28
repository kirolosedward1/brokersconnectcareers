/**
 * UTF-8, both ways, with no dependency on the engine.
 *
 * The session is stored encrypted, and AES works on bytes. The session holds
 * the user's metadata — an Arabic name among it — so the conversion has to be
 * real UTF-8, not a byte per character. Written out rather than trusting
 * TextEncoder and TextDecoder to exist in every Hermes this app will run on.
 */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let text = '';
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index];
    let code: number;
    let width: number;
    if (first < 0x80) {
      code = first;
      width = 1;
    } else if (first >= 0xf0) {
      code = first & 0x07;
      width = 4;
    } else if (first >= 0xe0) {
      code = first & 0x0f;
      width = 3;
    } else {
      code = first & 0x1f;
      width = 2;
    }
    for (let offset = 1; offset < width; offset += 1) {
      code = (code << 6) | ((bytes[index + offset] ?? 0) & 0x3f);
    }
    text += String.fromCodePoint(code);
    index += width;
  }
  return text;
}
