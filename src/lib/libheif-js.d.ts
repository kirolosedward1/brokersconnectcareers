/** The wasm build of libheif-js. It compiles with WebAssembly.Module and does not eval. */
declare module 'libheif-js/wasm-bundle' {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display(image: ImageData, callback: (displayed: ImageData | null) => void): void;
    free(): void;
  }

  interface HeifDecoderInstance {
    decoder: unknown;
    decode(buffer: Uint8Array): HeifImage[] | undefined;
  }

  interface Libheif {
    HeifDecoder: new () => HeifDecoderInstance;
    heif_context_free(decoder: unknown): void;
  }

  const libheif: Libheif;
  export default libheif;
}
