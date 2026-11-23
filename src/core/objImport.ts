import type { MeshData, Placement, RowSpan, Run, TileSpec } from "./types";
import { buildWall } from "./wall";

/**
 * Rebuild a DisplayForge screen from an OBJ by analysing its mesh and UV map.
 *
 * Requirements on the OBJ (met by DisplayForge's own exports and by most
 * LED-wall meshes made of one quad per tile):
 *   - UVs on a regular grid that covers the whole screen (u = column / columns,
 *     v = row / rows, v = 0 at the bottom), with a vertex on every tile corner;
 *   - one tile width and one tile height for the whole wall;
 *   - tiles hinged along vertical edges (columns may be curved, rows are straight).
 *
 * The tile's pixel resolution is not stored in an OBJ: it comes from the
 * caller (e.g. the LED screen that uses the mesh in Designer).
 */

/* ------------------------------------------------------------------ parsing */

export interface ParsedObj {
  positions: number[][];
  uvs: number[][];
  /** Triangles as [positionIndex, uvIndex] × 3 (0-based). */
  triangles: Array<[number, number][]>;
}

export function parseObj(text: string): ParsedObj {
  const positions: number[][] = [];
  const uvs: number[][] = [];
  const triangles: Array<[number, number][]> = [];
  let facesWithoutUv = 0;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const p = line.split(/\s+/).slice(1, 4).map(Number);
      positions.push(p);
    } else if (line.startsWith("vt ")) {
      const t = line.split(/\s+/).slice(1, 3).map(Number);
      uvs.push(t);
    } else if (line.startsWith("f ")) {
      const refs = line
        .split(/\s+/)
        .slice(1)
        .map((token) => {
          const [vi, ti] = token.split("/");
          const v = Number(vi);
          const t = ti ? Number(ti) : NaN;
          return [v < 0 ? positions.length + v : v - 1, t < 0 ? uvs.length + t : t - 1] as [number, number];
        });
      if (refs.some(([, t]) => !Number.isFinite(t))) {
        facesWithoutUv++;
        continue;
      }
      for (let k = 1; k + 1 < refs.length; k++) triangles.push([refs[0], refs[k], refs[k + 1]]);
    }
  }
  if (positions.some((p) => p.length < 3 || p.some((n) => !Number.isFinite(n)))) throw new Error("The OBJ has invalid vertex lines.");
  if (triangles.length === 0) {
    throw new Error(facesWithoutUv > 0 ? "The OBJ faces have no UV coordinates (vt): a UV map is required." : "The OBJ contains no faces.");
  }
  for (const tri of triangles) {
    for (const [v, t] of tri) {
      if (!positions[v] || !uvs[t]) throw new Error("The OBJ refers to vertices or UVs that do not exist.");
    }
  }
  return { positions, uvs, triangles };
}

/** Same structure from a MeshData (used to compare an imported OBJ with the rebuilt wall). */
function parsedFromMesh(mesh: MeshData): ParsedObj {
  const positions: number[][] = [];
  const uvs: number[][] = [];
  for (let i = 0; i < mesh.vertices.length / 3; i++) {
    positions.push([mesh.vertices[i * 3], mesh.vertices[i * 3 + 1], mesh.vertices[i * 3 + 2]]);
    uvs.push([mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]]);
  }
  const triangles: Array<[number, number][]> = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    triangles.push([0, 1, 2].map((k) => [mesh.indices[i + k], mesh.indices[i + k]] as [number, number]));
  }
  return { positions, uvs, triangles };
}

/* ------------------------------------------------------------- UV grid */

const MAX_GRID = 4096;

/** Smallest N such that every value is a multiple of 1/N. */
function gridDivisions(values: number[], axis: string): number {
  const distinct = [...new Set(values.map((v) => Math.round(v * 1e6) / 1e6))];
  if (distinct.some((v) => v < -1e-4 || v > 1 + 1e-4)) throw new Error(`The ${axis} coordinates of the UV map are outside 0…1.`);
  for (let n = 1; n <= MAX_GRID; n++) {
    const tol = Math.min(0.02, 0.1 / n) * 1; // fraction of a cell
    if (distinct.every((v) => Math.abs(v * n - Math.round(v * n)) < tol * 1)) return n;
  }
  throw new Error(`The UV map is not a regular grid along ${axis}.`);
}

function cellKey(i: number, j: number) {
  return `${i},${j}`;
}

interface GridAnalysis {
  columns: number;
  rows: number;
  /** present[j][i]: tile at column i, row j counted from the BOTTOM. */
  present: boolean[][];
  /** World position of grid corner (i, j) (j from the bottom), averaged over the vertices that share it. */
  corners: Map<string, number[]>;
}

function analyseGrid(obj: ParsedObj): GridAnalysis {
  const used = new Set<number>();
  for (const tri of obj.triangles) for (const [, t] of tri) used.add(t);
  const us = [...used].map((t) => obj.uvs[t][0]);
  const vs = [...used].map((t) => obj.uvs[t][1]);
  const columns = gridDivisions(us, "U");
  const rows = gridDivisions(vs, "V");

  const present = Array.from({ length: rows }, () => new Array<boolean>(columns).fill(false));
  for (const tri of obj.triangles) {
    const p = tri.map(([, t]) => [obj.uvs[t][0] * columns, obj.uvs[t][1] * rows]);
    const minI = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
    const maxI = Math.min(columns - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])) - 1);
    const minJ = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
    const maxJ = Math.min(rows - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])) - 1);
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(area) < 1e-12) continue;
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        // Cell centre inside the triangle? (barycentric, with a small tolerance for shared edges)
        const x = i + 0.5, y = j + 0.5;
        const w0 = ((p[1][0] - x) * (p[2][1] - y) - (p[2][0] - x) * (p[1][1] - y)) / area;
        const w1 = ((p[2][0] - x) * (p[0][1] - y) - (p[0][0] - x) * (p[2][1] - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) present[j][i] = true;
      }
    }
  }

  const sums = new Map<string, { s: number[]; n: number }>();
  for (const tri of obj.triangles) {
    for (const [v, t] of tri) {
      const fi = obj.uvs[t][0] * columns;
      const fj = obj.uvs[t][1] * rows;
      const i = Math.round(fi), j = Math.round(fj);
      if (Math.abs(fi - i) > 1e-3 || Math.abs(fj - j) > 1e-3) continue;
      const key = cellKey(i, j);
      const e = sums.get(key) ?? { s: [0, 0, 0], n: 0 };
      const p = obj.positions[v];
      e.s[0] += p[0]; e.s[1] += p[1]; e.s[2] += p[2]; e.n++;
      sums.set(key, e);
    }
  }
  const corners = new Map<string, number[]>();
  for (const [k, e] of sums) corners.set(k, e.s.map((x) => x / e.n));
  return { columns, rows, present, corners };
}

/* ------------------------------------------------------------- vectors */

type V3 = number[];
const sub = (a: V3, b: V3) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.sqrt(dot(a, a));
const unit = (a: V3) => scale(a, 1 / (len(a) || 1));

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ------------------------------------------------------------- import */

export interface ObjImportResult {
  tile: TileSpec;
  runs: Run[];
  rows: RowSpan[];
  placement: Placement;
  columns: number;
  rowCount: number;
  tileCount: number;
  /** Largest distance between a corner of the OBJ and the same corner of the rebuilt wall (mm). */
  maxErrorMm: number;
  warnings: string[];
}

export interface ObjImportOptions {
  /** Tile pixel resolution (not stored in an OBJ). */
  tileResolutionX: number;
  tileResolutionY: number;
}

const DEG = 180 / Math.PI;
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits + 0; // + 0 turns -0 into 0

export function importObj(text: string, options: ObjImportOptions): ObjImportResult {
  const obj = parseObj(text);
  const grid = analyseGrid(obj);
  const { columns, rows: rowCount, present, corners } = grid;
  const warnings: string[] = [];
  const corner = (i: number, j: number) => corners.get(cellKey(i, j));

  /* ---- rows (top to bottom), one contiguous span each ---- */
  const rows: RowSpan[] = [];
  for (let r = 0; r < rowCount; r++) {
    const line = present[rowCount - 1 - r];
    const lit = line.flatMap((on, i) => (on ? [i] : []));
    if (lit.length === 0) {
      rows.push({ startColumn: 0, columnCount: 0 });
      continue;
    }
    const start = lit[0], end = lit[lit.length - 1] + 1;
    if (end - start !== lit.length) {
      warnings.push(`Row ${r + 1} has gaps: DisplayForge keeps one continuous span per row, so the gaps were filled.`);
    }
    rows.push({ startColumn: start, columnCount: end - start });
  }
  const tileCount = rows.reduce((n, r) => n + r.columnCount, 0);
  if (tileCount === 0) throw new Error("No tiles found in the UV map.");

  /* ---- tile size and wall frame ---- */
  const widths: number[] = [];
  const heights: number[] = [];
  const ups: V3[] = [];
  for (let j = 0; j < rowCount; j++) {
    for (let i = 0; i < columns; i++) {
      if (!present[j][i]) continue;
      const bl = corner(i, j), br = corner(i + 1, j), tl = corner(i, j + 1), tr = corner(i + 1, j + 1);
      if (!bl || !br || !tl || !tr) throw new Error("The mesh has no vertex on every tile corner of the UV grid.");
      widths.push(len(sub(br, bl)), len(sub(tr, tl)));
      heights.push(len(sub(tl, bl)), len(sub(tr, br)));
      ups.push(sub(tl, bl), sub(tr, br));
    }
  }
  const tileW = median(widths);
  const tileH = median(heights);
  if (!(tileW > 0 && tileH > 0)) throw new Error("The tiles have no size.");
  const spread = (list: number[], ref: number) => Math.max(...list.map((x) => Math.abs(x - ref))) / ref;
  if (spread(widths, tileW) > 0.01) warnings.push("Tile widths differ by more than 1 %: the average width was used.");
  if (spread(heights, tileH) > 0.01) warnings.push("Tile heights differ by more than 1 %: the average height was used.");
  const up = unit(ups.reduce(add, [0, 0, 0]));

  /* ---- column directions → hinge angles → runs ---- */
  const dirs: (V3 | null)[] = [];
  for (let i = 0; i < columns; i++) {
    let d: V3 | null = null;
    for (let j = 0; j < rowCount && !d; j++) {
      if (!present[j][i]) continue;
      const a = corner(i, j), b = corner(i + 1, j);
      if (a && b) {
        const h = sub(b, a);
        d = unit(sub(h, scale(up, dot(h, up)))); // horizontal part
      }
    }
    dirs.push(d);
  }
  if (dirs.some((d) => !d)) warnings.push("Some columns have no tiles at all: their hinge angle was assumed to be 0°.");

  // Front face: DisplayForge's front is direction × up. Compare with the triangle winding.
  let facing = 0;
  for (const tri of obj.triangles) {
    const [a, b, c] = tri.map(([v]) => obj.positions[v]);
    const n = cross(sub(b, a), sub(c, a));
    const ua = obj.uvs[tri[0][1]];
    const i = Math.min(columns - 1, Math.max(0, Math.floor(((ua[0] + obj.uvs[tri[1][1]][0] + obj.uvs[tri[2][1]][0]) / 3) * columns)));
    const d = dirs[i];
    if (d) facing += Math.sign(dot(n, cross(d, up)));
  }
  if (facing < 0) warnings.push("The faces point backwards compared with the UV layout (mirrored UVs or flipped winding): the rebuilt wall faces the other way.");

  const angles: number[] = new Array(columns).fill(0);
  for (let i = 1; i < columns; i++) {
    const a = dirs[i - 1], b = dirs[i];
    if (!a || !b) continue;
    // Positive DisplayForge angle turns the heading from +X towards +Z, i.e. around -up.
    angles[i] = Math.atan2(-dot(up, cross(a, b)), dot(a, b)) * DEG;
  }
  const runs: Run[] = [];
  for (let i = 0; i < columns; i++) {
    const angle = round(i === 0 ? (columns > 1 ? angles[1] : 0) : angles[i], 3);
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.angleBetweenTilesDeg - angle) < 0.01) last.columns++;
    else if (i === 0) runs.push({ columns: 1, angleBetweenTilesDeg: angle });
    else runs.push({ columns: 1, angleBetweenTilesDeg: angle });
  }

  const tile: TileSpec = {
    tileWidthMm: round(tileW * 1000, 2),
    tileHeightMm: round(tileH * 1000, 2),
    tileResolutionX: Math.max(1, Math.round(options.tileResolutionX)),
    tileResolutionY: Math.max(1, Math.round(options.tileResolutionY)),
  };

  /* ---- placement: rigid fit of the rebuilt wall onto the OBJ ---- */
  const neutral: Placement = { originX: "center", originY: "bottom", rotationDeg: { x: 0, y: 0, z: 0 }, positionM: { x: 0, y: 0, z: 0 } };
  const base = buildWall({ name: "import", tile, runs, rows, placement: neutral });
  const baseGrid = analyseGrid(parsedFromMesh(base.mesh));
  const pairs: Array<[V3, V3]> = [];
  for (const [key, target] of corners) {
    const source = baseGrid.corners.get(key);
    if (source) pairs.push([source, target]);
  }
  const { rotation, translation } = rigidFit(pairs);
  const euler = eulerZYX(rotation);
  const placement: Placement = {
    originX: "center",
    originY: "bottom",
    rotationDeg: { x: round(euler.x, 4), y: round(euler.y, 4), z: round(euler.z, 4) },
    positionM: { x: round(translation[0], 5), y: round(translation[1], 5), z: round(translation[2], 5) },
  };

  // Rebuild with the found placement and measure the error.
  const placed = analyseGrid(parsedFromMesh(buildWall({ name: "import", tile, runs, rows, placement }).mesh));
  let maxError = 0;
  for (const [key, target] of corners) {
    const p = placed.corners.get(key);
    if (p) maxError = Math.max(maxError, len(sub(p, target)));
  }
  const maxErrorMm = round(maxError * 1000, 2);
  if (maxErrorMm > 5) warnings.push(`The rebuilt wall differs from the OBJ by up to ${maxErrorMm} mm: check runs and tile size.`);

  return { tile, runs, rows, placement, columns, rowCount, tileCount, maxErrorMm, warnings };
}

/* ------------------------------------------------------------- rigid fit */

/** Least-squares rotation + translation mapping sources onto targets (Kabsch, via Horn's quaternion method). */
function rigidFit(pairs: Array<[V3, V3]>): { rotation: number[][]; translation: V3 } {
  const n = pairs.length;
  const cs = scale(pairs.reduce((s, [a]) => add(s, a), [0, 0, 0]), 1 / n);
  const ct = scale(pairs.reduce((s, [, b]) => add(s, b), [0, 0, 0]), 1 / n);
  const S = [0, 0, 0].map(() => [0, 0, 0]);
  for (const [a, b] of pairs) {
    const p = sub(a, cs), q = sub(b, ct);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += p[r] * q[c];
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const q = largestEigenvector(N);
  const [w, x, y, z] = q;
  const rotation = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  const rc = [0, 1, 2].map((r) => dot(rotation[r], cs));
  return { rotation, translation: sub(ct, rc) };
}

/** Eigenvector of the largest eigenvalue of a symmetric 4×4 matrix (Jacobi rotations). */
function largestEigenvector(m: number[][]): number[] {
  const a = m.map((r) => [...r]);
  const v: number[][] = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [0, 1, 2, 3].map((k) => v[k][best]);
}

/**
 * Angles (degrees) of R = Rz · Ry · Rx, the order DisplayForge applies the
 * user rotation in (X tilt first, then Y heading, then Z roll).
 */
function eulerZYX(R: number[][]): { x: number; y: number; z: number } {
  const sy = Math.max(-1, Math.min(1, -R[2][0]));
  const y = Math.asin(sy);
  let x: number, z: number;
  if (Math.abs(sy) < 0.999999) {
    x = Math.atan2(R[2][1], R[2][2]);
    z = Math.atan2(R[1][0], R[0][0]);
  } else {
    x = Math.atan2(-R[1][2], R[1][1]);
    z = 0;
  }
  const clean = (a: number) => (Math.abs(a) < 1e-9 ? 0 : a * DEG);
  return { x: clean(x), y: clean(y), z: clean(z) };
}

/** Screen name from a file name or path ("objects/Mesh/Wall_V3.obj" → "Wall_V3"). */
export function nameFromPath(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.obj$/i, "") || "Imported screen";
}
