import type { MeshData, Placement, RowSpan, Run, TileSpec } from "./types";
import { normalizeRows, sanitizeRuns, sanitizeTile } from "./sanitize";

/* ------------------------------------------------------------------------ */
/* Tile chain (plan layout of the columns in the XZ plane)                   */
/* ------------------------------------------------------------------------ */

export interface ChainTile {
  index: number;
  startX: number;
  startZ: number;
  headingRad: number;
}

export interface TileChain {
  tiles: ChainTile[];
  tileWidthM: number;
}

export function buildTileChain(tileWidthMm: number, runs: Run[]): TileChain {
  const tileWidthM = tileWidthMm / 1000;
  const tiles: ChainTile[] = [];
  let x = 0;
  let z = 0;
  let heading = 0;
  for (const run of runs) {
    const step = (run.angleBetweenTilesDeg * Math.PI) / 180;
    for (let i = 0; i < run.columns; i++) {
      if (tiles.length > 0) heading += step;
      tiles.push({ index: tiles.length, startX: x, startZ: z, headingRad: heading });
      x += tileWidthM * Math.cos(heading);
      z += tileWidthM * Math.sin(heading);
    }
  }
  return { tiles, tileWidthM };
}

/** Column edge points of the chain: point k is the left edge of column k (k = 0..n). */
export function chainEdgePoints(chain: TileChain): Array<[number, number]> {
  const pts: Array<[number, number]> = chain.tiles.map((t) => [t.startX, t.startZ]);
  const last = chain.tiles[chain.tiles.length - 1];
  if (last) {
    pts.push([
      last.startX + chain.tileWidthM * Math.cos(last.headingRad),
      last.startZ + chain.tileWidthM * Math.sin(last.headingRad),
    ]);
  }
  return pts;
}

/** Heading (radians) at the middle of the wall's unrolled length. */
export function midHeadingRad(chain: TileChain): number {
  const n = chain.tiles.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return chain.tiles[(n - 1) / 2].headingRad;
  // Even count: the middle is the joint between two tiles; average both headings.
  return (chain.tiles[n / 2 - 1].headingRad + chain.tiles[n / 2].headingRad) / 2;
}

/* ------------------------------------------------------------------------ */
/* Placement transform (shared by mesh, plan view and 3D preview)           */
/* ------------------------------------------------------------------------ */

export type Point3 = [number, number, number];

export interface WallFrame {
  /** Points of the chain at column edges, in chain space (y = 0). */
  edges: Array<[number, number]>;
  heightM: number;
  autoOrientationDeg: number;
}

/**
 * Build the transform from "chain space" to world space:
 *   1. auto-orientation: rotate around Y so the middle of the wall faces +Z;
 *   2. origin: move the chosen origin point (left end / middle / right end of
 *      the wall, at the bottom / middle / top of the grid) to (0,0,0);
 *   3. user rotation X (tilt), then Y (heading), then Z (roll);
 *   4. user position.
 * Returns separate functions for points and for direction vectors (normals).
 */
export function makePlacementTransform(frame: WallFrame, placement: Placement) {
  const auto = (frame.autoOrientationDeg * Math.PI) / 180;
  const rotY = (x: number, z: number, a: number): [number, number] => [
    x * Math.cos(a) + z * Math.sin(a),
    -x * Math.sin(a) + z * Math.cos(a),
  ];

  // Origin point, computed in auto-oriented space.
  const edges = frame.edges;
  let ox = 0;
  let oz = 0;
  if (edges.length > 0) {
    const pick = (k: number): [number, number] => rotY(edges[k][0], edges[k][1], auto);
    if (placement.originX === "left") [ox, oz] = pick(0);
    else if (placement.originX === "right") [ox, oz] = pick(edges.length - 1);
    else {
      // Midpoint along the unrolled length.
      const n = edges.length - 1;
      if (n % 2 === 0) [ox, oz] = pick(n / 2);
      else {
        const a = pick((n - 1) / 2);
        const b = pick((n + 1) / 2);
        ox = (a[0] + b[0]) / 2;
        oz = (a[1] + b[1]) / 2;
      }
    }
  }
  const oy = placement.originY === "top" ? frame.heightM : placement.originY === "middle" ? frame.heightM / 2 : 0;

  const rx = (placement.rotationDeg.x * Math.PI) / 180;
  const ry = (placement.rotationDeg.y * Math.PI) / 180;
  const rz = (placement.rotationDeg.z * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  const rotate = (x: number, y: number, z: number): Point3 => {
    // X (tilt)
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    // Y (heading) — same handedness as the auto-orientation
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    // Z (roll)
    const x3 = x2 * cz - y1 * sz;
    const y3 = x2 * sz + y1 * cz;
    return [x3, y3, z2];
  };

  const { x: px, y: py, z: pz } = placement.positionM;

  return {
    point(x: number, y: number, z: number): Point3 {
      const [ax, az] = rotY(x, z, auto);
      const [r0, r1, r2] = rotate(ax - ox, y - oy, az - oz);
      return [r0 + px, r1 + py, r2 + pz];
    },
    direction(x: number, y: number, z: number): Point3 {
      const [ax, az] = rotY(x, z, auto);
      return rotate(ax, y, az);
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Wall build                                                               */
/* ------------------------------------------------------------------------ */

export interface WallInput {
  name: string;
  tile: TileSpec;
  runs: Run[];
  rows: RowSpan[];
  placement: Placement;
}

export interface WallResult {
  mesh: MeshData;
  totalColumns: number;
  rowCount: number;
  tileCount: number;
  resolutionX: number;
  resolutionY: number;
  physicalWidthMm: number;
  physicalHeightMm: number;
  autoOrientationDeg: number;
  /** Bottom edge of the full grid in world space, column edges left→right. */
  planPoints: Point3[];
  /** Footprint of the populated wall in world XZ. */
  footprint: { width: number; depth: number };
}

export function buildWall(input: WallInput): WallResult {
  const tile = sanitizeTile(input.tile);
  const runs = sanitizeRuns(input.runs);
  const chain = buildTileChain(tile.tileWidthMm, runs);
  const totalColumns = chain.tiles.length;
  const rows = normalizeRows(input.rows, Math.max(1, input.rows.length), totalColumns);
  const rowCount = rows.length;
  const tileH = tile.tileHeightMm / 1000;
  const heightM = tileH * rowCount;
  const edges = chainEdgePoints(chain);
  const autoOrientationDeg = (midHeadingRad(chain) * 180) / Math.PI;
  const xf = makePlacementTransform({ edges, heightM, autoOrientationDeg }, input.placement);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let tileCount = 0;

  for (let r = 0; r < rowCount; r++) {
    // rows[0] is the TOP row.
    const y0 = (rowCount - 1 - r) * tileH;
    const y1 = y0 + tileH;
    const v0 = (rowCount - 1 - r) / rowCount;
    const v1 = (rowCount - r) / rowCount;
    const { startColumn, columnCount } = rows[r];
    for (let c = startColumn; c < startColumn + columnCount; c++) {
      const [xa, za] = edges[c];
      const [xb, zb] = edges[c + 1];
      const h = chain.tiles[c].headingRad;
      const n = xf.direction(-Math.sin(h), 0, Math.cos(h));
      const u0 = c / totalColumns;
      const u1 = (c + 1) / totalColumns;
      const base = positions.length / 3;
      // BL, BR, TL, TR — counter-clockwise when seen from the front.
      const corners: Array<[number, number, number, number, number]> = [
        [xa, y0, za, u0, v0],
        [xb, y0, zb, u1, v0],
        [xa, y1, za, u0, v1],
        [xb, y1, zb, u1, v1],
      ];
      for (const [x, y, z, u, v] of corners) {
        positions.push(...xf.point(x, y, z));
        normals.push(...n);
        uvs.push(u, v);
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      tileCount++;
    }
  }

  const mesh = toMeshData(positions, normals, uvs, indices, input.name);
  const planPoints = edges.map(([x, z]) => xf.point(x, 0, z));

  return {
    mesh,
    totalColumns,
    rowCount,
    tileCount,
    resolutionX: tile.tileResolutionX * totalColumns,
    resolutionY: tile.tileResolutionY * rowCount,
    physicalWidthMm: tile.tileWidthMm * totalColumns,
    physicalHeightMm: tile.tileHeightMm * rowCount,
    autoOrientationDeg,
    planPoints,
    footprint: {
      width: mesh.boundingBox.max[0] - mesh.boundingBox.min[0],
      depth: mesh.boundingBox.max[2] - mesh.boundingBox.min[2],
    },
  };
}

export function toMeshData(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  uvs: ArrayLike<number>,
  indices: ArrayLike<number>,
  objectType: string,
): MeshData {
  const vertices = Float32Array.from(positions);
  const idx = Uint32Array.from(indices);
  return {
    vertices,
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: idx,
    boundingBox: boundingBox(vertices),
    metadata: { objectType, vertexCount: vertices.length / 3, triangleCount: idx.length / 3 },
  };
}

export function boundingBox(v: ArrayLike<number>): MeshData["boundingBox"] {
  if (v.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = v[i + k];
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
  }
  return { min, max };
}

export function mergeMeshes(meshes: MeshData[], objectType = "merged"): MeshData {
  let nv = 0;
  let ni = 0;
  for (const m of meshes) {
    nv += m.vertices.length / 3;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const uvs = new Float32Array(nv * 2);
  const indices = new Uint32Array(ni);
  let v = 0;
  let i = 0;
  for (const m of meshes) {
    positions.set(m.vertices, v * 3);
    normals.set(m.normals, v * 3);
    uvs.set(m.uvs, v * 2);
    for (let k = 0; k < m.indices.length; k++) indices[i + k] = m.indices[k] + v;
    v += m.vertices.length / 3;
    i += m.indices.length;
  }
  return toMeshData(positions, normals, uvs, indices, objectType);
}
