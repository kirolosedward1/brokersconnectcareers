/**
 * A photo made the size it is shown at, in the browser, before it is uploaded.
 *
 * Profile photos were stored as picked — up to the bucket's 2 MB, and a phone
 * photo is usually close to that — and drawn as a plain <img> at 28 to 64 CSS
 * pixels: in the header, on every applicant card, on every directory card.
 * A directory page of 24 consultants with photos could ask the reader's phone
 * for 40 MB to draw 24 circles, and every byte of it was Supabase egress, which
 * the Free plan caps at 5 GB a month for the whole organisation.
 *
 * 320 px on the long side covers the largest circle at 3x density with room to
 * spare; as JPEG at 0.85 that is 20–40 KB. Photos only: a logo keeps its own
 * format (transparency), and goes through next/image anyway.
 *
 * Returns null when the browser cannot decode the file, so the caller can fall
 * back to uploading the original under the bucket's own limit — a failed
 * resize should cost bytes, never the upload.
 */
export async function downscalePhoto(
  file: Blob,
  { maxSide = 320, quality = 0.85 }: { maxSide?: number; quality?: number } = {},
): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null;

  let bitmap: ImageBitmap;
  try {
    // Honours EXIF orientation by default, so a portrait phone photo stays upright.
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;

    // JPEG has no transparency; a transparent PNG would otherwise turn black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } finally {
    bitmap.close();
  }
}
