import type { PopulationVariant, ProjectState, ScreenConfig } from "./types";
import {
  sanitizeTestPattern,
  MAX_ROWS,
  clamp,
  normalizeRows,
  positiveInt,
  sanitizeMask,
  sanitizePlacement,
  sanitizePopulations,
  sanitizeRuns,
  sanitizeShape,
  sanitizeTile,
} from "./sanitize";
import { autoFitShape, fullRows, rowsForShape, type GridSize } from "./shapes";

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `screen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function totalColumns(screen: Pick<ScreenConfig, "runs">): number {
  return screen.runs.reduce((sum, r) => sum + r.columns, 0);
}

export function gridOf(screen: ScreenConfig): GridSize {
  return {
    rowCount: screen.rows.length,
    totalColumns: totalColumns(screen),
    tileWidthMm: screen.tile.tileWidthMm,
    tileHeightMm: screen.tile.tileHeightMm,
  };
}

export function createScreen(name: string): ScreenConfig {
  const runs = [
    { columns: 6, angleBetweenTilesDeg: 0 },
    { columns: 6, angleBetweenTilesDeg: 8 },
    { columns: 6, angleBetweenTilesDeg: 0 },
  ];
  const cols = totalColumns({ runs });
  const screen: ScreenConfig = {
    id: newId(),
    name,
    tile: { tileWidthMm: 500, tileHeightMm: 500, tileResolutionX: 176, tileResolutionY: 176 },
    runs,
    rows: fullRows(4, cols),
    shape: sanitizeShape(undefined, cols),
    placement: sanitizePlacement(undefined),
    populations: [],
    mask: sanitizeMask(undefined),
    testPattern: sanitizeTestPattern(undefined),
  };
  refit(screen);
  return screen;
}

export function cloneScreen(source: ScreenConfig, name: string): ScreenConfig {
  const copy: ScreenConfig = JSON.parse(JSON.stringify(source));
  copy.id = newId();
  copy.name = name;
  delete copy.designer;
  copy.populations = copy.populations.map((v) => ({ ...v, id: newId() }));
  return copy;
}

/**
 * Re-derive rows after the grid (runs/rows/tile size) or the shape settings
 * changed. Auto-fit parameters are refreshed first when enabled.
 */
export function refit(screen: ScreenConfig): void {
  const g = gridOf(screen);
  if (screen.shape.autoFit) Object.assign(screen.shape, autoFitShape(g));
  screen.rows = rowsForShape(screen.shape, g, screen.rows);
}

export function setRowCount(screen: ScreenConfig, count: number): void {
  const n = clamp(positiveInt(count), 1, MAX_ROWS);
  const cols = totalColumns(screen);
  // Keep existing rows (top-anchored) and add full rows at the bottom.
  screen.rows = normalizeRows(screen.rows.slice(0, n), n, cols);
  refit(screen);
}

export function sanitizeScreen(raw: unknown, fallbackName: string): ScreenConfig {
  const s = (raw ?? {}) as Partial<ScreenConfig>;
  const runs = sanitizeRuns(s.runs);
  const cols = totalColumns({ runs });
  const rowsIn = Array.isArray(s.rows) && s.rows.length > 0 ? s.rows : fullRows(4, cols);
  const screen: ScreenConfig = {
    id: typeof s.id === "string" && s.id ? s.id : newId(),
    name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : fallbackName,
    tile: sanitizeTile(s.tile),
    runs,
    rows: normalizeRows(rowsIn, Math.min(rowsIn.length, MAX_ROWS), cols),
    shape: sanitizeShape(s.shape, cols),
    placement: sanitizePlacement(s.placement),
    populations: [],
    mask: sanitizeMask(s.mask),
    testPattern: sanitizeTestPattern(s.testPattern),
  };
  screen.populations = sanitizePopulations(s.populations, screen.rows.length, cols, newId);
  if (s.designer && typeof s.designer.resourceName === "string") screen.designer = s.designer;
  // Legacy data without shape info: keep rows as they are.
  if (!s.shape) screen.shape.kind = "custom";
  return screen;
}

export function sanitizeProject(raw: unknown): ProjectState | null {
  const p = raw as Partial<ProjectState> | null;
  if (!p || !Array.isArray(p.screens) || p.screens.length === 0) return null;
  const screens = p.screens.map((s, i) => sanitizeScreen(s, `Screen ${i + 1}`));
  // De-duplicate ids.
  const seen = new Set<string>();
  for (const s of screens) {
    if (seen.has(s.id)) s.id = newId();
    seen.add(s.id);
  }
  const activeId = screens.some((s) => s.id === p.activeId) ? (p.activeId as string) : screens[0].id;
  return { version: 1, activeId, screens };
}

export function nextScreenName(screens: ScreenConfig[]): string {
  let n = screens.length + 1;
  const names = new Set(screens.map((s) => s.name));
  while (names.has(`Screen ${n}`)) n++;
  return `Screen ${n}`;
}

/** New population variant starting from the screen's current shape. */
export function createPopulation(screen: ScreenConfig, name: string): PopulationVariant {
  return { id: newId(), name, rows: screen.rows.map((r) => ({ ...r })) };
}

export function nextPopulationName(screen: ScreenConfig): string {
  let n = screen.populations.length + 1;
  const names = new Set(screen.populations.map((p) => p.name));
  while (names.has(`Variant ${n}`)) n++;
  return `Variant ${n}`;
}
