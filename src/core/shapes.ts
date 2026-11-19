import type { RowSpan, ShapeSettings } from "./types";
import { normalizeRows } from "./sanitize";

/**
 * Shape generators. Every generator returns rows TOP-to-BOTTOM (rows[0] = top),
 * centred in the grid with the same parity as the column count so that
 * left/right symmetry is exact.
 */

export interface GridSize {
  rowCount: number;
  totalColumns: number;
  tileWidthMm: number;
  tileHeightMm: number;
}

export function fullRows(rowCount: number, totalColumns: number): RowSpan[] {
  return Array.from({ length: rowCount }, () => ({ startColumn: 0, columnCount: totalColumns }));
}

/** Round `target` to the nearest width with the same parity as `total`, within [min, total]. */
export function snapCenteredWidth(target: number, total: number, min: number): number {
  const parity = total % 2;
  let w = Math.min(total, Math.max(0, Math.round(target)));
  if (w % 2 !== parity) {
    const below = w - 1 < 0 ? parity : w - 1;
    const above = w + 1 > total ? w - 1 : w + 1;
    w = target - below < above - target ? below : above;
  }
  return Math.min(total, Math.max(min, w));
}

/** Largest width <= target with the parity of `total`. */
export function floorCenteredWidth(target: number, total: number): number {
  const parity = total % 2;
  let w = Math.min(total, Math.max(0, Math.floor(target + 1e-8)));
  if (w % 2 !== parity) w--;
  return Math.max(parity ? 1 : 0, w);
}

const centred = (width: number, total: number): RowSpan => ({
  startColumn: (total - width) / 2,
  columnCount: width,
});

export function triangleRows(g: GridSize, baseColumns: number, apex: "top" | "bottom"): RowSpan[] {
  const { rowCount: R, totalColumns: n } = g;
  const minW = n % 2 ? 1 : 2;
  const base = Math.min(n, Math.max(1, baseColumns));
  return Array.from({ length: R }, (_, i) => {
    // i = 0 is the top row.
    const t = apex === "top" ? (i + 0.5) / R : 1 - (i + 0.5) / R;
    return centred(snapCenteredWidth(base * t, n, minW), n);
  });
}

export function circleRows(g: GridSize, diameterColumns: number): RowSpan[] {
  const { rowCount: R, totalColumns: n, tileWidthMm: tw, tileHeightMm: th } = g;
  const radius = Math.min(diameterColumns * tw, n * tw, R * th) / 2;
  return Array.from({ length: R }, (_, i) => {
    const dy = Math.abs((i + 0.5 - R / 2) * th);
    let count = 0;
    if (dy < radius) {
      const half = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      for (let c = 0; c < n; c++) if (Math.abs((c + 0.5 - n / 2) * tw) <= half + 1e-7) count++;
    }
    return centred(count, n);
  });
}

export function diamondRows(g: GridSize, widthColumns: number): RowSpan[] {
  const { rowCount: R, totalColumns: n, tileWidthMm: tw, tileHeightMm: th } = g;
  const size = Math.min(widthColumns * tw, n * tw, R * th);
  const minW = n % 2 ? 1 : 2;
  return Array.from({ length: R }, (_, i) => {
    const dy = Math.abs((i + 0.5 - R / 2) * th);
    const width = dy < size / 2 ? snapCenteredWidth(Math.max(0, size - 2 * dy) / tw, n, minW) : 0;
    return centred(width, n);
  });
}

/** Default (auto-fit) shape parameters for a grid. */
export function autoFitShape(g: GridSize): Pick<ShapeSettings, "triangleBaseColumns" | "circleDiameterColumns" | "diamondWidthColumns"> {
  const widthMm = g.totalColumns * g.tileWidthMm;
  const heightMm = g.rowCount * g.tileHeightMm;
  const tri = Math.min(widthMm, (heightMm * 2) / Math.sqrt(3)) / g.tileWidthMm;
  const fit = Math.min(widthMm, heightMm) / g.tileWidthMm;
  return {
    triangleBaseColumns: Math.max(1, floorCenteredWidth(tri, g.totalColumns)),
    circleDiameterColumns: Math.max(1, floorCenteredWidth(fit, g.totalColumns)),
    diamondWidthColumns: Math.max(1, floorCenteredWidth(fit, g.totalColumns)),
  };
}

/**
 * Rows for a shape. For "custom", the existing rows are kept and only
 * resized/clamped to the grid.
 */
export function rowsForShape(shape: ShapeSettings, g: GridSize, currentRows: RowSpan[]): RowSpan[] {
  let rows: RowSpan[];
  switch (shape.kind) {
    case "triangle":
      rows = triangleRows(g, shape.triangleBaseColumns, shape.triangleApex);
      break;
    case "circle":
      rows = circleRows(g, shape.circleDiameterColumns);
      break;
    case "diamond":
      rows = diamondRows(g, shape.diamondWidthColumns);
      break;
    case "custom":
      rows = currentRows;
      break;
    default:
      rows = fullRows(g.rowCount, g.totalColumns);
  }
  return normalizeRows(rows, g.rowCount, g.totalColumns);
}
