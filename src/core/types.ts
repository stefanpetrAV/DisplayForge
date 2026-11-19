/**
 * DisplayForge data model.
 *
 * Coordinate conventions (shared by mesh, OBJ export, 3D preview and plan view):
 *   - Units: metres. Right-handed, +Y up (standard OBJ / three.js convention).
 *   - The tile chain is laid out in the XZ plane. With no extra rotation the
 *     wall's front face points to +Z (towards the audience / default camera).
 *   - Columns are numbered left-to-right as seen from the front.
 *   - Rows are numbered TOP-to-BOTTOM: rows[0] is the top row of the wall.
 *     The 2D grid, the row table, the 3D preview and the exported OBJ all use
 *     this same convention.
 *   - UVs: u = 0..1 left-to-right, v = 0 at the bottom edge, 1 at the top edge
 *     (OBJ convention), over the unrolled width/height of the full grid.
 */

export interface TileSpec {
  tileWidthMm: number;
  tileHeightMm: number;
  tileResolutionX: number;
  tileResolutionY: number;
}

/** A run of consecutive tile columns. */
export interface Run {
  columns: number;
  /** Hinge angle applied at the joint *before* every tile of this run
   *  (including the joint with the previous run). The first tile of the wall
   *  has no joint before it. Positive bends the wall towards the audience. */
  angleBetweenTilesDeg: number;
}

/** Populated span of one row (rows are top-to-bottom). */
export interface RowSpan {
  startColumn: number;
  columnCount: number;
}

export type ShapeKind = "rectangle" | "triangle" | "circle" | "diamond" | "custom";
export type Apex = "top" | "bottom";

export interface ShapeSettings {
  kind: ShapeKind;
  /** When true, the size parameters below are re-fitted whenever the grid or tile size changes. */
  autoFit: boolean;
  triangleBaseColumns: number;
  triangleApex: Apex;
  circleDiameterColumns: number;
  diamondWidthColumns: number;
}

export type OriginX = "left" | "center" | "right";
export type OriginY = "bottom" | "middle" | "top";

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Placement {
  originX: OriginX;
  originY: OriginY;
  /** Extra rotation on top of the automatic orientation (degrees). */
  rotationDeg: Vec3Like;
  positionM: Vec3Like;
}

/** Record of the LED screen created in disguise Designer from this screen. */
export interface DesignerLink {
  resourceName: string;
  resolution: [number, number];
  updatedAt: string;
}

/** One screen as stored on disk / in localStorage. Plain JSON only. */
export interface ScreenConfig {
  id: string;
  name: string;
  tile: TileSpec;
  runs: Run[];
  rows: RowSpan[];
  shape: ShapeSettings;
  placement: Placement;
  designer?: DesignerLink;
}

export interface ProjectState {
  version: 1;
  activeId: string;
  screens: ScreenConfig[];
}

export interface MeshData {
  vertices: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  metadata: { objectType: string; vertexCount: number; triangleCount: number };
}
