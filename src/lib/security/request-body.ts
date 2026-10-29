import { readWithin } from '@/lib/mobile-api/body';

/** Bound public POST bodies even when Content-Length is absent or dishonest. */
export async function readRequestText(
  request: Request,
  limit: number,
): Promise<{ text: string } | { refused: Response }> {
  const reject = (status: number, error: string) => ({
    refused: Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } }),
  });
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return reject(413, 'too_large');
  try {
    const result = await readWithin(request.body, limit);
    if ('tooLarge' in result) return reject(413, 'too_large');
    return { text: new TextDecoder().decode(result.bytes) };
  } catch {
    return reject(400, 'malformed');
  }
}
