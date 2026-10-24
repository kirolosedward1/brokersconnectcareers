/**
 * Decode the primary frame of a HEIC, and refuse a file that is not all there.
 *
 * libheif's own display path decodes with no options. On a grid — the way an
 * iPhone stores a photograph, one tile per block — a missing tile is then not
 * an error. The tile is skipped, a warning is stored on the image, and the
 * gap stays the colour of a zeroed plane, which comes out green. That frame
 * was uploaded. A warning or a short item is a file we will not keep. A logo
 * that is almost all one colour is still a picture, and is kept.
 *
 * The wasm module is passed in. The worker bundles it; a test can load the
 * same build. This file does not import it, so the phone app never does either.
 */
import { pickHeicFrame } from '@/lib/image-upload';

export type DecodedHeic = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

/** The slice of libheif-js this decoder calls. The wasm build provides it. */
export type HeifLib = {
  HEAPU8: Uint8Array;
  HeifDecoder: new () => {
    decoder: unknown;
    decode(buffer: Uint8Array): HeifImage[] | undefined;
  };
  heif_context_free(decoder: unknown): void;
  heif_colorspace: { heif_colorspace_RGB: { value: number } };
  heif_chroma: { heif_chroma_interleaved_RGBA: { value: number } };
  heif_channel: { heif_channel_interleaved: { value: number } };
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _heif_decoding_options_alloc(): number;
  _heif_decoding_options_free(pointer: number): void;
  _heif_decode_image(err: number, handle: number, imageOut: number, colorspace: number, chroma: number, options: number): void;
  _heif_image_handle_decode_image_tile(
    err: number,
    handle: number,
    imageOut: number,
    colorspace: number,
    chroma: number,
    options: number,
    tileX: number,
    tileY: number,
  ): void;
  _heif_image_get_decoding_warnings(image: number, first: number, out: number, max: number): number;
  _heif_image_release(image: number): void;
  _heif_image_handle_get_context(handle: number): number;
  _heif_image_handle_get_item_id(handle: number): number;
  _heif_image_handle_get_image_tiling(err: number, handle: number, transformed: number, out: number): void;
  _heif_image_handle_get_grid_image_tile_id(err: number, handle: number, transformed: number, tileX: number, tileY: number, out: number): void;
  _heif_item_get_item_type(context: number, itemId: number): number;
  _heif_item_get_item_data(err: number, context: number, itemId: number, compression: number, dataOut: number, sizeOut: number): void;
  _heif_release_item_data(context: number, data: number): void;
  _heif_image_get_plane_readonly2(image: number, channel: number, strideOut: number): number;
  _heif_image_get_width(image: number, channel: number): number;
  _heif_image_get_height(image: number, channel: number): number;
};

type HeifImage = {
  handle: { $$: { ptr: number } };
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  free(): void;
};

/**
 * `strict_decoding` in libheif 1.23.5's `heif_decoding_options` on wasm32.
 *
 * The struct is a version byte, `ignore_transformations`, four pointers,
 * `convert_hdr_to_8bit`, then this flag. `alloc` writes version 10 and the
 * defaults. A different version is a different layout, and decoding without
 * the flag is how a short grid becomes a green picture, so that build is refused.
 */
const OPTIONS_VERSION = 10;
const STRICT_DECODING_OFFSET = 21;

/** More tiles than this is not a photograph; it is a file trying to make us loop. */
const MAX_TILES = 128;

const GRID = fourccCode('grid');
const RGB_VALUE = 1;
const RGBA_VALUE = 11;
const INTERLEAVED = 10;

/**
 * The primary frame, packed RGBA, every tile present.
 *
 * Throws when the file is short, the bytes after the header are not a
 * picture, or libheif reports anything. The caller turns that into the
 * "could not be read" sentence and clears the picker. Nothing here is caught.
 */
export function decodeHeicPrimary(lib: HeifLib, bytes: Uint8Array): DecodedHeic {
  const decoder = new lib.HeifDecoder();
  let images: HeifImage[] = [];
  const spare: number[] = [];
  let options = 0;
  try {
    images = decoder.decode(bytes) ?? [];
    const chosen = pickHeicFrame(
      images.map((image) => ({
        image,
        primary: Boolean(image.is_primary()),
        width: image.get_width(),
        height: image.get_height(),
      })),
    );
    if (!chosen || chosen.width < 1 || chosen.height < 1) throw new Error('empty');

    const handle = chosen.image.handle?.$$?.ptr;
    if (!handle) throw new Error('empty');
    const context = lib._heif_image_handle_get_context(handle);
    if (!context) throw new Error('empty');

    options = lib._heif_decoding_options_alloc();
    if (!options || lib.HEAPU8[options] !== OPTIONS_VERSION) throw new Error('decode');
    lib.HEAPU8[options + STRICT_DECODING_OFFSET] = 1;

    const colorspace = lib.heif_colorspace?.heif_colorspace_RGB?.value ?? RGB_VALUE;
    const chroma = lib.heif_chroma?.heif_chroma_interleaved_RGBA?.value ?? RGBA_VALUE;
    const channel = lib.heif_channel?.heif_channel_interleaved?.value ?? INTERLEAVED;

    const itemId = lib._heif_image_handle_get_item_id(handle) >>> 0;
    const itemIds = [itemId];
    if ((lib._heif_item_get_item_type(context, itemId) >>> 0) === GRID) {
      const tiling = readTiling(lib, spare, handle);
      for (let y = 0; y < tiling.rows; y++) {
        for (let x = 0; x < tiling.columns; x++) itemIds.push(gridTileId(lib, spare, handle, x, y));
      }
    }

    const locations = readItemLocations(bytes);
    for (const id of itemIds) {
      const expected = locations.get(id);
      if (!expected || !expected.inside) throw new Error('truncated');
      const actual = itemByteLength(lib, spare, context, id);
      if (actual !== expected.length) throw new Error('truncated');
    }

    if (itemIds.length > 1) {
      const tiling = readTiling(lib, spare, handle);
      for (let y = 0; y < tiling.rows; y++) {
        for (let x = 0; x < tiling.columns; x++) releaseImage(lib, decodeToImage(lib, spare, 'tile', handle, options, colorspace, chroma, x, y));
      }
    }

    const image = decodeToImage(lib, spare, 'image', handle, options, colorspace, chroma);
    try {
      const warnings = lib._heif_image_get_decoding_warnings(image, 0, 0, 0);
      if (warnings !== 0) throw new Error('warning');
      const planeWidth = lib._heif_image_get_width(image, channel);
      const planeHeight = lib._heif_image_get_height(image, channel);
      if (planeWidth !== chosen.width || planeHeight !== chosen.height) throw new Error('truncated');
      const pixels = copyPlane(lib, spare, image, channel, chosen.width, chosen.height);
      return { width: chosen.width, height: chosen.height, pixels };
    } finally {
      lib._heif_image_release(image);
    }
  } finally {
    for (const pointer of spare) lib._free(pointer);
    if (options) lib._heif_decoding_options_free(options);
    for (const image of images) image.free();
    if (decoder.decoder) lib.heif_context_free(decoder.decoder);
  }
}

function decodeToImage(
  lib: HeifLib,
  spare: number[],
  kind: 'image' | 'tile',
  handle: number,
  options: number,
  colorspace: number,
  chroma: number,
  tileX = 0,
  tileY = 0,
): number {
  const err = alloc(lib, spare, 16);
  const imageOut = alloc(lib, spare, 4);
  setU32(lib, imageOut, 0);
  if (kind === 'tile') lib._heif_image_handle_decode_image_tile(err, handle, imageOut, colorspace, chroma, options, tileX, tileY);
  else lib._heif_decode_image(err, handle, imageOut, colorspace, chroma, options);
  const code = view(lib).getInt32(err, true);
  const image = view(lib).getUint32(imageOut, true);
  if (code !== 0 || !image) {
    if (image) lib._heif_image_release(image);
    throw new Error(code !== 0 ? 'decode' : 'empty');
  }
  const warnings = lib._heif_image_get_decoding_warnings(image, 0, 0, 0);
  if (warnings !== 0) {
    lib._heif_image_release(image);
    throw new Error('warning');
  }
  return image;
}

function releaseImage(lib: HeifLib, image: number) {
  lib._heif_image_release(image);
}

function readTiling(lib: HeifLib, spare: number[], handle: number): { columns: number; rows: number } {
  const err = alloc(lib, spare, 16);
  const out = alloc(lib, spare, 80);
  lib.HEAPU8.fill(0, out, out + 80);
  lib._heif_image_handle_get_image_tiling(err, handle, 0, out);
  if (view(lib).getInt32(err, true) !== 0) throw new Error('decode');
  const memory = view(lib);
  const columns = memory.getUint32(out + 4, true);
  const rows = memory.getUint32(out + 8, true);
  if (columns < 1 || rows < 1 || columns > MAX_TILES || rows > MAX_TILES) throw new Error('decode');
  return { columns, rows };
}

function gridTileId(lib: HeifLib, spare: number[], handle: number, tileX: number, tileY: number): number {
  const err = alloc(lib, spare, 16);
  const out = alloc(lib, spare, 4);
  setU32(lib, out, 0);
  lib._heif_image_handle_get_grid_image_tile_id(err, handle, 0, tileX, tileY, out);
  if (view(lib).getInt32(err, true) !== 0) throw new Error('tile');
  const id = view(lib).getUint32(out, true);
  if (!id) throw new Error('tile');
  return id;
}

/** Bytes libheif actually returns for an item. A short read is not the item. */
function itemByteLength(lib: HeifLib, spare: number[], context: number, itemId: number): number {
  const err = alloc(lib, spare, 16);
  const dataOut = alloc(lib, spare, 4);
  const sizeOut = alloc(lib, spare, 4);
  setU32(lib, dataOut, 0);
  setU32(lib, sizeOut, 0);
  lib._heif_item_get_item_data(err, context, itemId, 0, dataOut, sizeOut);
  const code = view(lib).getInt32(err, true);
  const data = view(lib).getUint32(dataOut, true);
  const size = view(lib).getUint32(sizeOut, true);
  if (data) {
    const slot = alloc(lib, spare, 4);
    setU32(lib, slot, data);
    lib._heif_release_item_data(context, slot);
  }
  if (code !== 0) throw new Error('truncated');
  return size;
}

function copyPlane(lib: HeifLib, spare: number[], image: number, channel: number, width: number, height: number): Uint8Array {
  const strideOut = alloc(lib, spare, 4);
  const plane = lib._heif_image_get_plane_readonly2(image, channel, strideOut);
  const stride = view(lib).getUint32(strideOut, true);
  if (!plane || stride < width * 4) throw new Error('decode');
  const heap = lib.HEAPU8;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = plane + y * stride;
    pixels.set(heap.subarray(row, row + width * 4), y * width * 4);
  }
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  return pixels;
}

function alloc(lib: HeifLib, spare: number[], bytes: number): number {
  const pointer = lib._malloc(bytes);
  if (!pointer) throw new Error('decode');
  spare.push(pointer);
  return pointer;
}

function view(lib: HeifLib): DataView {
  const heap = lib.HEAPU8;
  return new DataView(heap.buffer, heap.byteOffset, heap.byteLength);
}

function setU32(lib: HeifLib, pointer: number, value: number) {
  view(lib).setUint32(pointer, value, true);
}

type ItemLocation = { length: number; inside: boolean };

/**
 * Where each item's bytes live, from the `iloc` box, and whether that range
 * is actually inside the file.
 *
 * The length libheif returns has to equal this. A file cut off after the
 * header still carries the original `iloc`, pointing past the last byte;
 * that item is not complete, even when a best-effort decode paints something.
 */
function readItemLocations(bytes: Uint8Array): Map<number, ItemLocation> {
  const iloc = findBox(bytes, 0, bytes.length, 'iloc');
  const idat = findBox(bytes, 0, bytes.length, 'idat');
  if (!iloc) throw new Error('truncated');
  const locations = new Map<number, ItemLocation>();
  let cursor = iloc.start + iloc.header;
  const end = iloc.start + iloc.size;
  const version = bytes[cursor];
  if (version === undefined || version > 2) throw new Error('truncated');
  cursor += 4;
  const offsetSize = (bytes[cursor]! >> 4) & 0xf;
  const lengthSize = bytes[cursor]! & 0xf;
  cursor += 1;
  const baseSize = (bytes[cursor]! >> 4) & 0xf;
  const indexSize = version === 0 ? 0 : bytes[cursor]! & 0xf;
  cursor += 1;
  const itemCount = version < 2 ? readUnsigned(bytes, cursor, 2, end) : readUnsigned(bytes, cursor, 4, end);
  cursor += version < 2 ? 2 : 4;
  const idatStart = idat ? idat.start + idat.header : 0;
  const idatEnd = idat ? idat.start + idat.size : 0;

  for (let item = 0; item < itemCount; item++) {
    const id = version < 2 ? readUnsigned(bytes, cursor, 2, end) : readUnsigned(bytes, cursor, 4, end);
    cursor += version < 2 ? 2 : 4;
    let method = 0;
    if (version !== 0) {
      method = readUnsigned(bytes, cursor, 2, end) & 0xf;
      cursor += 2;
    }
    const dataReference = readUnsigned(bytes, cursor, 2, end);
    cursor += 2;
    const base = readUnsigned(bytes, cursor, baseSize, end);
    cursor += baseSize;
    const extentCount = readUnsigned(bytes, cursor, 2, end);
    cursor += 2;
    let length = 0;
    let inside = dataReference === 0 && (method === 0 || method === 1);
    if (method === 1 && !idat) inside = false;
    for (let extent = 0; extent < extentCount; extent++) {
      if (indexSize) cursor += indexSize;
      const offset = readUnsigned(bytes, cursor, offsetSize, end);
      cursor += offsetSize;
      let extentLength = readUnsigned(bytes, cursor, lengthSize, end);
      cursor += lengthSize;
      const origin = method === 1 ? idatStart : 0;
      const limit = method === 1 ? idatEnd : bytes.length;
      const start = origin + base + offset;
      if (extentLength === 0) extentLength = Math.max(0, limit - start);
      length += extentLength;
      if (start < origin || extentLength < 0 || start + extentLength > limit) inside = false;
    }
    locations.set(id, { length, inside });
  }
  return locations;
}

type Box = { start: number; size: number; header: number };

function findBox(bytes: Uint8Array, start: number, end: number, name: string): Box | null {
  let cursor = start;
  while (cursor + 8 <= end) {
    let size = readUnsigned(bytes, cursor, 4, end);
    const type = String.fromCharCode(bytes[cursor + 4]!, bytes[cursor + 5]!, bytes[cursor + 6]!, bytes[cursor + 7]!);
    let header = 8;
    if (size === 1) {
      size = readUnsigned(bytes, cursor + 8, 8, end);
      header = 16;
    } else if (size === 0) size = end - cursor;
    if (size < header || cursor + size > end) return null;
    if (type === name) return { start: cursor, size, header };
    if (type === 'meta') {
      const nested = findBox(bytes, cursor + header + 4, cursor + size, name);
      if (nested) return nested;
    }
    cursor += size;
  }
  return null;
}

function readUnsigned(bytes: Uint8Array, offset: number, size: number, end: number): number {
  if (size === 0) return 0;
  if (offset < 0 || size < 0 || offset + size > end || offset + size > bytes.length) throw new Error('truncated');
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + (bytes[offset + i] ?? 0);
  if (!Number.isSafeInteger(value)) throw new Error('truncated');
  return value;
}

function fourccCode(text: string): number {
  return ((text.charCodeAt(0) & 255) << 24) | ((text.charCodeAt(1) & 255) << 16) | ((text.charCodeAt(2) & 255) << 8) | (text.charCodeAt(3) & 255);
}
