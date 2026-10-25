import { decodeHeicPrimary, type HeifLib } from '@/lib/heic-decode';
import libheif from 'libheif-js/wasm-bundle';

/**
 * Decode a HEIC off the page thread.
 *
 * libheif-js's wasm build is compiled with WebAssembly.Module, which the
 * page's script-src allows through 'wasm-unsafe-eval' and not through eval.
 * The module is bundled into this worker, so the bytes come from this origin.
 *
 * The image handed back is the primary frame at its own size, and only when
 * every tile and every item of that frame was actually in the file. A short
 * or garbled HEIC is an error, not a green picture.
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
  try {
    const decoded = decodeHeicPrimary(libheif as unknown as HeifLib, new Uint8Array(buffer));
    const pixels = new ArrayBuffer(decoded.pixels.byteLength);
    new Uint8Array(pixels).set(decoded.pixels);
    scope.postMessage({ width: decoded.width, height: decoded.height, pixels }, [pixels]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'failed' });
  }
};
