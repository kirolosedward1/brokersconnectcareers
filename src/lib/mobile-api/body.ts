/**
 * A request body, read no further than a limit.
 *
 * A declared length over the limit is refused before anything is read (the
 * caller does that); a body that declares none — chunked — is counted here
 * as it arrives, and reading stops at the first byte past the limit. Read with
 * `request.text()` or `request.formData()` instead, the whole body was held in
 * memory before its size was looked at: a few hundred megabytes sent without a
 * length were taken in full to be refused.
 *
 * No runtime imports, so scripts/mobile-api-body.test.mjs runs it under Node.
 */
export async function readWithin(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer> } | { tooLarge: true }> {
  if (!body) return { bytes: new Uint8Array(0) };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        // Nothing more is wanted from the sender.
        await reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}
