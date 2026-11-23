import type { MaskAbsent, RowSpan, TileSpec } from "./types";
import { resourceName } from "./obj";

/**
 * Population masks for disguise Designer.
 *
 * A population mask is a still image laid over the LED screen's UV space that
 * says which pixels exist. DisplayForge's UVs cover the full rows × columns
 * grid (u = column / totalColumns, v = row / rowCount), so the mask is just the
 * tile grid drawn at the screen resolution: every lit tile is a white
 * rectangle of tileResolutionX × tileResolutionY pixels. Tile edges always fall
 * on whole pixels, so the mask is hard-edged (pure white / absent) by construction.
 */

/** Largest texture side Designer handles on the CPU path. */
export const MAX_TEXTURE_SIDE = 16384;

/**
 * Clip a variant's rows into the screen's rows: a variant can only light tiles
 * that exist in the mesh. Rows missing from the variant (e.g. rows added to the
 * screen later) follow the screen.
 */
export function clipToScreen(screenRows: RowSpan[], variantRows: RowSpan[] | null | undefined): RowSpan[] {
  if (!variantRows) return screenRows.map((r) => ({ ...r }));
  return screenRows.map((s, i) => {
    const v = variantRows[i];
    if (!v) return { ...s };
    const start = Math.max(s.startColumn, v.startColumn);
    const end = Math.min(s.startColumn + s.columnCount, v.startColumn + v.columnCount);
    return end > start ? { startColumn: start, columnCount: end - start } : { startColumn: s.startColumn, columnCount: 0 };
  });
}

export function litTileCount(rows: RowSpan[]): number {
  return rows.reduce((n, r) => n + r.columnCount, 0);
}

export interface MaskLayout {
  totalColumns: number;
  /** Lit span of every row, top-to-bottom. */
  rows: RowSpan[];
  width: number;
  height: number;
  /** Pixel position of every column edge (totalColumns + 1 values, 0 … width). */
  columnEdges: number[];
  /** Pixel position of every row edge (rows.length + 1 values, 0 … height, top to bottom). */
  rowEdges: number[];
  /** Resolution of the LED screen (tile resolution × grid). */
  screenWidth: number;
  screenHeight: number;
  /** True when the screen is larger than MAX_TEXTURE_SIDE and the mask was scaled down. */
  scaled: boolean;
}

/** Edge positions of `count` equal UV cells spread over `size` pixels, rounded to whole pixels. */
function edges(count: number, size: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round((i * size) / count));
}

/**
 * Mask size and tile edges.
 *
 * At or below MAX_TEXTURE_SIDE the mask has the screen resolution and every
 * tile is exactly tileResolutionX × tileResolutionY pixels. Larger screens are
 * scaled down automatically with ONE factor for both axes, so the long side is
 * exactly MAX_TEXTURE_SIDE and the aspect ratio is kept, whatever the tile
 * format (square or not). Tile edges are then placed on the whole pixel
 * nearest to their exact UV position (u = column / columns, v = row / rows),
 * so the mask stays hard-edged; neighbouring tiles may differ by 1 px.
 */
export function maskLayout(totalColumns: number, rows: RowSpan[], tile: TileSpec): MaskLayout {
  const screenWidth = totalColumns * tile.tileResolutionX;
  const screenHeight = rows.length * tile.tileResolutionY;
  const longest = Math.max(screenWidth, screenHeight);
  const scaled = longest > MAX_TEXTURE_SIDE;
  const s = scaled ? MAX_TEXTURE_SIDE / longest : 1;
  const width = Math.min(MAX_TEXTURE_SIDE, Math.max(1, Math.round(screenWidth * s)));
  const height = Math.min(MAX_TEXTURE_SIDE, Math.max(1, Math.round(screenHeight * s)));
  return {
    totalColumns,
    rows,
    width,
    height,
    columnEdges: edges(totalColumns, width),
    rowEdges: edges(rows.length, height),
    screenWidth,
    screenHeight,
    scaled,
  };
}

/** Smallest and largest tile size in pixels (equal when the mask is not scaled). */
export function tilePixelRange(layout: MaskLayout): { minW: number; maxW: number; minH: number; maxH: number } {
  const sizes = (e: number[]) => e.slice(1).map((v, i) => v - e[i]);
  const w = sizes(layout.columnEdges);
  const h = sizes(layout.rowEdges);
  return { minW: Math.min(...w), maxW: Math.max(...w), minH: Math.min(...h), maxH: Math.max(...h) };
}

/** Resource-safe PNG base name: "<screen>_population" for the screen's own shape, "<screen>_<variant>" otherwise. */
export function maskFileName(screenName: string, variantName?: string | null): string {
  return resourceName(`${screenName}_${variantName ?? "population"}`);
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32([typeBytes, data]));
  return out;
}

/**
 * Encode the mask as an 8-bit RGBA PNG: lit tiles white, absent tiles either
 * transparent (alpha 0) or opaque black.
 *
 * The image can be large (16800 × 3000 px = 200 MB raw), so it is streamed
 * through the deflate compressor line by line. Every pixel row inside a tile
 * row equals the one above it, so it is written with the PNG "Up" filter as all
 * zeros and compresses to almost nothing.
 */
export async function encodeMaskPng(layout: MaskLayout, absent: MaskAbsent): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("This browser cannot compress PNG images (CompressionStream is not available).");
  }
  const { width, height, rows, columnEdges, rowEdges } = layout;
  if (width <= 0 || height <= 0) throw new Error("The mask has no pixels.");
  const stride = 1 + width * 4;
  const off = absent === "black" ? [0, 0, 0, 255] : [0, 0, 0, 0];

  const stream = new CompressionStream("deflate"); // zlib format, as PNG requires
  const compressed = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  const sameAsAbove = new Uint8Array(stride);
  sameAsAbove[0] = 2; // filter "Up", all differences zero

  // Column of every pixel x.
  const columnOf = new Int32Array(width);
  for (let c = 0; c < columnEdges.length - 1; c++) columnOf.fill(c, columnEdges[c], columnEdges[c + 1]);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const lines = rowEdges[r + 1] - rowEdges[r];
    if (lines <= 0) continue;
    const line = new Uint8Array(stride); // filter 0 ("None")
    for (let x = 0; x < width; x++) {
      const col = columnOf[x];
      const lit = col >= row.startColumn && col < row.startColumn + row.columnCount;
      const p = 1 + x * 4;
      if (lit) {
        line[p] = 255;
        line[p + 1] = 255;
        line[p + 2] = 255;
        line[p + 3] = 255;
      } else {
        line[p] = off[0];
        line[p + 1] = off[1];
        line[p + 2] = off[2];
        line[p + 3] = off[3];
      }
    }
    await writer.write(line);
    for (let y = 1; y < lines; y++) await writer.write(sameAsAbove);
  }
  await writer.close();
  const idat = new Uint8Array(await compressed);

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // compression, filter and interlace methods stay 0

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}
