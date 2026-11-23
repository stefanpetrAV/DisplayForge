import type { PatternColor, RowSpan, TileSpec } from "./types";
import { MAX_TEXTURE_SIDE } from "./mask";
import { resourceName } from "./obj";

/**
 * Test patterns for LED screens.
 *
 * One pattern covers the whole LED screen at its native resolution (tile
 * resolution × grid). Every tile is one checkerboard cell. Each column has a
 * single colour, chosen among the selected R G B Y C M colours in turn
 * (column c → colors[c mod n]), alternating with neutral grey down the
 * column; neighbouring columns are offset by one tile, giving a checkerboard.
 * Tiles that are not populated are black.
 *
 * The image is split into equal parts only when a side exceeds
 * MAX_TEXTURE_SIDE (16384 px): a 20000 × 2800 screen gives two 10000 × 2800
 * files. Split points fall on tile edges whenever that keeps every part
 * within the limit.
 */

export type Rgb = readonly [number, number, number];

/** 75 % primaries / secondaries (comfortable on LED, still unambiguous). */
export const PATTERN_COLORS: readonly { name: PatternColor; rgb: Rgb }[] = [
  { name: "R", rgb: [191, 0, 0] },
  { name: "G", rgb: [0, 191, 0] },
  { name: "B", rgb: [0, 0, 191] },
  { name: "Y", rgb: [191, 191, 0] },
  { name: "C", rgb: [0, 191, 191] },
  { name: "M", rgb: [191, 0, 191] },
];
/** Neutral grey of the checkerboard (R = G = B). */
export const PATTERN_GREY: Rgb = [64, 64, 64];
export const PATTERN_ABSENT: Rgb = [0, 0, 0];

const ALL_COLORS = PATTERN_COLORS.map((c) => c.name);

/**
 * Colour of tile (row, col), both 0-based, rows top-to-bottom: null for grey
 * (even row + col), otherwise the column's colour colors[col mod n].
 */
export function tileColorName(row: number, col: number, colors: readonly PatternColor[] = ALL_COLORS): PatternColor | null {
  if ((row + col) % 2 === 0) return null;
  const list = colors.length ? colors : ALL_COLORS;
  return list[col % list.length];
}

export function tileColor(row: number, col: number, colors?: readonly PatternColor[]): Rgb {
  const name = tileColorName(row, col, colors);
  return name ? PATTERN_COLORS.find((c) => c.name === name)!.rgb : PATTERN_GREY;
}

export interface PatternPart {
  /** "A", "B", … (empty when the pattern is a single image). */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TestPatternLayout {
  screenName: string;
  totalColumns: number;
  rows: RowSpan[];
  tile: TileSpec;
  colors: PatternColor[];
  /** Full LED screen resolution. */
  width: number;
  height: number;
  parts: PatternPart[];
}

/** Split `size` px (made of `cells` cells of `cell` px) into the fewest equal parts ≤ max, preferring cell edges. */
export function splitAxis(size: number, cell: number, max = MAX_TEXTURE_SIDE): [number, number][] {
  const n = Math.max(1, Math.ceil(size / max));
  if (n === 1) return [[0, size]];
  const cells = cell > 0 ? Math.round(size / cell) : 0;
  const onEdges = (i: number) => (cells > 0 && cells * cell === size ? Math.round((i * cells) / n) * cell : -1);
  let cuts = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : i === n ? size : onEdges(i)));
  const ok = cuts.every((c) => c >= 0) && cuts.slice(1).every((c, i) => c - cuts[i] > 0 && c - cuts[i] <= max);
  if (!ok) cuts = Array.from({ length: n + 1 }, (_, i) => Math.round((i * size) / n));
  return cuts.slice(1).map((c, i) => [cuts[i], c - cuts[i]]);
}

export function testPatternLayout(
  screenName: string,
  totalColumns: number,
  rows: RowSpan[],
  tile: TileSpec,
  colors: PatternColor[] = [...ALL_COLORS],
): TestPatternLayout {
  const width = Math.max(1, totalColumns * tile.tileResolutionX);
  const height = Math.max(1, rows.length * tile.tileResolutionY);
  const xs = splitAxis(width, tile.tileResolutionX);
  const ys = splitAxis(height, tile.tileResolutionY);
  const single = xs.length * ys.length === 1;
  const parts: PatternPart[] = [];
  ys.forEach(([y, h], yi) =>
    xs.forEach(([x, w], xi) => {
      const k = yi * xs.length + xi;
      parts.push({ label: single ? "" : String.fromCharCode(65 + k), x, y, width: w, height: h });
    }),
  );
  return { screenName, totalColumns, rows, tile, colors, width, height, parts };
}

export function testPatternFileName(screenName: string, part: PatternPart): string {
  return resourceName(`${screenName}_testpattern${part.label ? `_${part.label}` : ""}`);
}

export function isTileLit(rows: RowSpan[], row: number, col: number): boolean {
  const r = rows[row];
  return !!r && col >= r.startColumn && col < r.startColumn + r.columnCount;
}
