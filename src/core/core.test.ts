import { describe, expect, it } from "vitest";
import { buildWall } from "./wall";
import { circleRows, diamondRows, triangleRows } from "./shapes";
import { createScreen, sanitizeProject, setRowCount, refit } from "./screen";
import { meshToObj } from "./obj";
import { normalizeRows, sanitizeRuns, sanitizeTile } from "./sanitize";
import type { Placement, RowSpan } from "./types";

const flat: Placement = {
  originX: "center",
  originY: "bottom",
  rotationDeg: { x: 0, y: 0, z: 0 },
  positionM: { x: 0, y: 0, z: 0 },
};
const tile = { tileWidthMm: 500, tileHeightMm: 500, tileResolutionX: 100, tileResolutionY: 100 };

function quadAt(result: ReturnType<typeof buildWall>, tileIndex: number) {
  const v = result.mesh.vertices;
  const b = tileIndex * 4 * 3;
  const corner = (k: number) => [v[b + k * 3], v[b + k * 3 + 1], v[b + k * 3 + 2]];
  return { bl: corner(0), br: corner(1), tl: corner(2), tr: corner(3) };
}

describe("row order (rows[0] is the top row)", () => {
  it("places the first row at the top of the mesh", () => {
    // Row 0 (top): only column 0. Row 1 (bottom): only column 3.
    const rows: RowSpan[] = [
      { startColumn: 0, columnCount: 1 },
      { startColumn: 3, columnCount: 1 },
    ];
    const r = buildWall({ name: "t", tile, runs: [{ columns: 4, angleBetweenTilesDeg: 0 }], rows, placement: flat });
    const top = quadAt(r, 0);
    const bottom = quadAt(r, 1);
    expect(top.bl[1]).toBeCloseTo(0.5);
    expect(top.tl[1]).toBeCloseTo(1.0);
    expect(bottom.bl[1]).toBeCloseTo(0);
    // Column 0 is on the left (-X) and column 3 on the right (+X) as seen from +Z.
    expect(top.bl[0]).toBeLessThan(0);
    expect(bottom.br[0]).toBeGreaterThan(0);
  });

  it("maps UV v=1 to the top edge and u=0 to the left", () => {
    const r = buildWall({
      name: "t",
      tile,
      runs: [{ columns: 2, angleBetweenTilesDeg: 0 }],
      rows: normalizeRows([], 2, 2),
      placement: flat,
    });
    const uv = r.mesh.uvs;
    // first tile = top row, column 0: BL uv = (0, 0.5), TL uv = (0, 1)
    expect([uv[0], uv[1]]).toEqual([0, 0.5]);
    expect([uv[4], uv[5]]).toEqual([0, 1]);
  });

  it("triangle apex 'top' is narrowest in rows[0]", () => {
    const rows = triangleRows({ rowCount: 5, totalColumns: 11, tileWidthMm: 500, tileHeightMm: 500 }, 11, "top");
    expect(rows[0].columnCount).toBeLessThan(rows[4].columnCount);
    const bottom = triangleRows({ rowCount: 5, totalColumns: 11, tileWidthMm: 500, tileHeightMm: 500 }, 11, "bottom");
    expect(bottom[0].columnCount).toBeGreaterThan(bottom[4].columnCount);
  });
});

describe("geometry", () => {
  it("front face faces +Z and winding is counter-clockwise from the front", () => {
    const r = buildWall({ name: "t", tile, runs: [{ columns: 1, angleBetweenTilesDeg: 0 }], rows: normalizeRows([], 1, 1), placement: flat });
    const n = r.mesh.normals;
    expect([n[0], n[1], n[2]].map((x) => Math.round(x))).toEqual([0, 0, 1]);
    const { bl, br, tl } = quadAt(r, 0);
    const e1 = [br[0] - bl[0], br[1] - bl[1], br[2] - bl[2]];
    const e2 = [tl[0] - bl[0], tl[1] - bl[1], tl[2] - bl[2]];
    const cross = e1[0] * e2[1] - e1[1] * e2[0];
    expect(cross).toBeGreaterThan(0);
  });

  it("a symmetric curve is centred and its ends come towards the audience (+Z)", () => {
    const r = buildWall({
      name: "t",
      tile,
      runs: [
        // Bends sit at the joint before each tile of the curved run, so 5/6/4
        // puts the 6 bends symmetrically around the middle of 15 columns.
        { columns: 5, angleBetweenTilesDeg: 0 },
        { columns: 6, angleBetweenTilesDeg: 10 },
        { columns: 4, angleBetweenTilesDeg: 0 },
      ],
      rows: normalizeRows([], 1, 15),
      placement: flat,
    });
    const first = r.planPoints[0];
    const last = r.planPoints[r.planPoints.length - 1];
    const mid = r.planPoints[(r.planPoints.length - 1) / 2 | 0];
    expect(first[2]).toBeGreaterThan(mid[2]);
    expect(last[2]).toBeGreaterThan(mid[2]);
    expect(first[2]).toBeCloseTo(last[2], 6);
    expect(first[0]).toBeCloseTo(-last[0], 6);
  });

  it("plan points and mesh share the same transform", () => {
    const placement: Placement = { ...flat, originX: "left", rotationDeg: { x: 0, y: 30, z: 0 }, positionM: { x: 2, y: 0, z: -1 } };
    const r = buildWall({ name: "t", tile, runs: [{ columns: 3, angleBetweenTilesDeg: 5 }], rows: normalizeRows([], 1, 3), placement });
    const q = quadAt(r, 0);
    expect(q.bl[0]).toBeCloseTo(r.planPoints[0][0]);
    expect(q.bl[2]).toBeCloseTo(r.planPoints[0][2]);
    // origin at the left end -> left end at the user position
    expect(r.planPoints[0][0]).toBeCloseTo(2);
    expect(r.planPoints[0][2]).toBeCloseTo(-1);
  });

  it("reports stats for partial rows", () => {
    const rows: RowSpan[] = [{ startColumn: 32, columnCount: 20 }, { startColumn: 28, columnCount: 56 }, ...normalizeRows([], 12, 84)];
    const r = buildWall({ name: "t", tile, runs: [{ columns: 84, angleBetweenTilesDeg: 0 }], rows, placement: flat });
    expect(r.tileCount).toBe(20 + 56 + 12 * 84);
    expect(r.resolutionX).toBe(8400);
    expect(r.resolutionY).toBe(1400);
  });

  it("writes a valid OBJ", () => {
    const r = buildWall({ name: "t", tile, runs: [{ columns: 2, angleBetweenTilesDeg: 0 }], rows: normalizeRows([], 1, 2), placement: flat });
    const obj = meshToObj(r.mesh, "My Screen");
    expect(obj).toContain("o My_Screen");
    expect(obj.match(/^v /gm)?.length).toBe(8);
    expect(obj.match(/^f /gm)?.length).toBe(4);
  });
});

describe("sanitizing", () => {
  it("never produces NaN from empty or invalid inputs", () => {
    expect(sanitizeRuns([{ columns: NaN, angleBetweenTilesDeg: NaN }])).toEqual([{ columns: 1, angleBetweenTilesDeg: 0 }]);
    expect(sanitizeRuns([{ columns: 2.6 as number, angleBetweenTilesDeg: 3 }])[0].columns).toBe(3);
    expect(sanitizeTile({ tileWidthMm: "" as unknown as number }).tileWidthMm).toBe(500);
  });

  it("round-trips a project through JSON", () => {
    const s = createScreen("A");
    s.shape.kind = "triangle";
    refit(s);
    const p = sanitizeProject(JSON.parse(JSON.stringify({ version: 1, activeId: s.id, screens: [s] })));
    expect(p?.screens[0]).toEqual(s);
  });

  it("changing the row count keeps custom rows", () => {
    const s = createScreen("A");
    s.shape.kind = "custom";
    s.rows[0] = { startColumn: 2, columnCount: 3 };
    setRowCount(s, 6);
    expect(s.rows.length).toBe(6);
    expect(s.rows[0]).toEqual({ startColumn: 2, columnCount: 3 });
  });
});

describe("shapes are left/right symmetric", () => {
  const g = { rowCount: 10, totalColumns: 10, tileWidthMm: 500, tileHeightMm: 500 };
  it("circle", () => {
    expect(circleRows(g, 10).map((r) => r.columnCount)).toEqual([4, 8, 8, 10, 10, 10, 10, 8, 8, 4]);
    for (const r of circleRows(g, 10)) expect(r.startColumn * 2 + r.columnCount).toBe(10);
  });
  it("diamond", () => {
    for (const r of diamondRows(g, 10)) expect(r.startColumn * 2 + r.columnCount).toBe(10);
  });
});
