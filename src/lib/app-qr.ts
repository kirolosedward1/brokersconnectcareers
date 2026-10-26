import 'server-only';
import QRCode from 'qrcode';

/**
 * A 120px QR of `text`, as an SVG with no XML prologue.
 *
 * Null when the library's answer is not an SVG we can put on the page.
 * The results card then omits the code rather than rendering a string.
 */
export async function qrSvg(text: string): Promise<string | null> {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: 0,
    width: 120,
    errorCorrectionLevel: 'M',
    color: { dark: '#111111', light: '#ffffff' },
  });
  const cleaned = svg.replace(/<\?xml[^>]*>\s*/i, '').trim();
  if (!cleaned.startsWith('<svg') || /<script/i.test(cleaned)) return null;
  return cleaned;
}
