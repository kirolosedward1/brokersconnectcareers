import { pickHeicFrame } from '@/lib/image-upload';
import libheif from 'libheif-js/wasm-bundle';

/**
 * Decode a HEIC off the page thread.
 *
 * libheif-js's wasm build is compiled with WebAssembly.Module, which the
 * page's script-src allows through 'wasm-unsafe-eval' and not through eval.
 * The module is bundled into this worker, so the bytes come from this origin.
 *
 * The image handed back is the primary frame at its own size. A HEIC from a
 * phone also carries a small preview; that preview is not the photograph.
 */

type WorkerRequest = { buffer: ArrayBuffer };

type WorkerResponse = { width: number; height: number; pixels: ArrayBuffer } | { error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const buffer = event.data?.buffer;
  if (!buffer) {
    scope.postMessage({ error: 'empty' });
    return;
  }
  void decodePrimary(buffer).then(
    (image) => {
      const pixels = new Uint8Array(image.data.byteLength);
      pixels.set(image.data);
      scope.postMessage({ width: image.width, height: image.height, pixels: pixels.buffer }, [pixels.buffer]);
    },
    (error: unknown) => {
      scope.postMessage({ error: error instanceof Error ? error.message : 'failed' });
    },
  );
};

async function decodePrimary(buffer: ArrayBuffer): Promise<ImageData> {
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(buffer)) ?? [];
  try {
    const chosen = pickHeicFrame(
      images.map((image) => ({
        image,
        primary: Boolean(image.is_primary()),
        width: image.get_width(),
        height: image.get_height(),
      })),
    );
    if (!chosen || chosen.width < 1 || chosen.height < 1) throw new Error('empty');
    const canvas = new ImageData(chosen.width, chosen.height);
    for (let i = 0; i < chosen.width * chosen.height; i++) canvas.data[i * 4 + 3] = 255;
    const displayed = await new Promise<ImageData>((resolve, reject) => {
      chosen.image.display(canvas, (data) => (data ? resolve(data) : reject(new Error('display'))));
    });
    if (displayed.width !== chosen.width || displayed.height !== chosen.height) throw new Error('size');
    return displayed;
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
  }
}
