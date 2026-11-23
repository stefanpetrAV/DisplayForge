import type { LevelsTest, PatternColor, RowSpan, TestPatternSettings, TileSpec } from "./types";
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
 * Colour bars under the screen name: 75 % bars (white, Y, C, G, M, R, B) on
 * the top two thirds, the same bars at 100 % on the bottom third.
 */
export const COLOR_BARS: readonly { name: string; rgb75: Rgb; rgb100: Rgb }[] = [
  { name: "W", rgb75: [191, 191, 191], rgb100: [255, 255, 255] },
  { name: "Y", rgb75: [191, 191, 0], rgb100: [255, 255, 0] },
  { name: "C", rgb75: [0, 191, 191], rgb100: [0, 255, 255] },
  { name: "G", rgb75: [0, 191, 0], rgb100: [0, 255, 0] },
  { name: "M", rgb75: [191, 0, 191], rgb100: [255, 0, 255] },
  { name: "R", rgb75: [191, 0, 0], rgb100: [255, 0, 0] },
  { name: "B", rgb75: [0, 0, 191], rgb100: [0, 0, 255] },
];

export interface LevelsSpec {
  title: string;
  /** Video black and white of the range. */
  black: number;
  white: number;
  /** Grey steps from black to white (inclusive). */
  steps: number[];
  /** Patches on a `black` background: below-black ones must vanish, above-black ones must show. */
  blackPatches: number[];
  /** Patches on a `white` background: below-white ones must show, above-white ones must vanish. */
  whitePatches: number[];
}

/**
 * Legal / full range test. On a legal (16–235) chain the patches below 16 and
 * above 235 blend into their background while those inside the range stay
 * visible; on a full (0–255) chain every near-black / near-white patch shows.
 */
export function levelsSpec(mode: LevelsTest): LevelsSpec | null {
  if (mode === "off") return null;
  const legal = mode === "legal";
  const black = legal ? 16 : 0;
  const white = legal ? 235 : 255;
  const steps = Array.from({ length: 11 }, (_, i) => Math.round(black + ((white - black) * i) / 10));
  return {
    title: legal ? "LEGAL 16–235" : "FULL 0–255",
    black,
    white,
    steps,
    blackPatches: legal ? [4, 8, 12, 20, 24, 28] : [2, 4, 8, 12, 16, 24],
    whitePatches: legal ? [223, 227, 231, 239, 243, 247] : [231, 239, 243, 247, 251, 253],
  };
}

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
  colorBars: boolean;
  levels: LevelsTest;
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
  settings: Partial<TestPatternSettings> = {},
): TestPatternLayout {
  const colors = settings.colors?.length ? [...settings.colors] : [...ALL_COLORS];
  const colorBars = settings.colorBars === true;
  const levels: LevelsTest = settings.levels ?? "off";
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
  return { screenName, totalColumns, rows, tile, colors, colorBars, levels, width, height, parts };
}

export function testPatternFileName(screenName: string, part: PatternPart): string {
  return resourceName(`${screenName}_testpattern${part.label ? `_${part.label}` : ""}`);
}

export function isTileLit(rows: RowSpan[], row: number, col: number): boolean {
  const r = rows[row];
  return !!r && col >= r.startColumn && col < r.startColumn + r.columnCount;
}
