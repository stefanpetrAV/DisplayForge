import type { Placement, RowSpan, Run, ShapeSettings, TileSpec, Vec3Like } from "./types";

export function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function positiveInt(value: unknown, fallback = 1): number {
  return Math.max(1, Math.round(finiteOr(value, fallback)));
}

export const MAX_COLUMNS_PER_RUN = 2000;
export const MAX_ROWS = 2000;

export function sanitizeTile(tile: Partial<TileSpec> | undefined): TileSpec {
  return {
    tileWidthMm: Math.max(1, finiteOr(tile?.tileWidthMm, 500)),
    tileHeightMm: Math.max(1, finiteOr(tile?.tileHeightMm, 500)),
    tileResolutionX: positiveInt(tile?.tileResolutionX, 176),
    tileResolutionY: positiveInt(tile?.tileResolutionY, 176),
  };
}

export function sanitizeRuns(runs: Partial<Run>[] | undefined): Run[] {
  const list = (runs ?? []).map((run) => ({
    columns: Math.min(MAX_COLUMNS_PER_RUN, positiveInt(run?.columns, 1)),
    angleBetweenTilesDeg: clamp(finiteOr(run?.angleBetweenTilesDeg, 0), -180, 180),
  }));
  return list.length > 0 ? list : [{ columns: 1, angleBetweenTilesDeg: 0 }];
}

/** Clamp rows to integer spans that fit inside the grid; pads/truncates to rowCount. */
export function normalizeRows(rows: Partial<RowSpan>[], rowCount: number, totalColumns: number): RowSpan[] {
  const count = clamp(Math.round(rowCount), 1, MAX_ROWS);
  return Array.from({ length: count }, (_, i) => {
    const row = rows[i] ?? { startColumn: 0, columnCount: totalColumns };
    const start = clamp(Math.round(finiteOr(row.startColumn, 0)), 0, totalColumns);
    const width = clamp(Math.round(finiteOr(row.columnCount, totalColumns)), 0, totalColumns - start);
    return { startColumn: start, columnCount: width };
  });
}

export function sanitizeVec(v: Partial<Vec3Like> | undefined): Vec3Like {
  return { x: finiteOr(v?.x, 0), y: finiteOr(v?.y, 0), z: finiteOr(v?.z, 0) };
}

export function sanitizePlacement(p: Partial<Placement> | undefined): Placement {
  const originX = p?.originX === "left" || p?.originX === "right" ? p.originX : "center";
  const originY = p?.originY === "middle" || p?.originY === "top" ? p.originY : "bottom";
  return { originX, originY, rotationDeg: sanitizeVec(p?.rotationDeg), positionM: sanitizeVec(p?.positionM) };
}

export function sanitizeShape(s: Partial<ShapeSettings> | undefined, totalColumns: number): ShapeSettings {
  const kinds = ["rectangle", "triangle", "circle", "diamond", "custom"] as const;
  const kind = kinds.includes(s?.kind as never) ? (s!.kind as ShapeSettings["kind"]) : "rectangle";
  return {
    kind,
    autoFit: s?.autoFit ?? true,
    triangleBaseColumns: positiveInt(s?.triangleBaseColumns, totalColumns),
    triangleApex: s?.triangleApex === "bottom" ? "bottom" : "top",
    circleDiameterColumns: positiveInt(s?.circleDiameterColumns, totalColumns),
    diamondWidthColumns: positiveInt(s?.diamondWidthColumns, totalColumns),
  };
}
