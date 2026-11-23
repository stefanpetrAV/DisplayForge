import { describe, expect, it } from "vitest";
import { buildWall } from "./wall";
import { meshToObj } from "./obj";
import { importObj, nameFromPath, parseObj } from "./objImport";
import type { Placement, RowSpan, Run, TileSpec } from "./types";

const neutral: Placement = { originX: "center", originY: "bottom", rotationDeg: { x: 0, y: 0, z: 0 }, positionM: { x: 0, y: 0, z: 0 } };

function roundTrip(tile: TileSpec, runs: Run[], rows: RowSpan[], placement: Placement) {
  const wall = buildWall({ name: "w", tile, runs, rows, placement });
  const text = meshToObj(wall.mesh, "w");
  return importObj(text, { tileResolutionX: tile.tileResolutionX, tileResolutionY: tile.tileResolutionY });
}

describe("OBJ import", () => {
  it("rebuilds a curved wall with a custom shape and an arbitrary placement", () => {
    const tile = { tileWidthMm: 500, tileHeightMm: 500, tileResolutionX: 200, tileResolutionY: 200 };
    const runs = [
      { columns: 6, angleBetweenTilesDeg: 0 },
      { columns: 10, angleBetweenTilesDeg: 7.5 },
      { columns: 4, angleBetweenTilesDeg: -3 },
    ];
    const rows: RowSpan[] = [
      { startColumn: 8, columnCount: 4 },
      { startColumn: 5, columnCount: 10 },
      ...Array.from({ length: 4 }, () => ({ startColumn: 0, columnCount: 20 })),
    ];
    const placement: Placement = { originX: "center", originY: "bottom", rotationDeg: { x: 5, y: 30, z: -2 }, positionM: { x: 1.5, y: 0.2, z: -3 } };
    const r = roundTrip(tile, runs, rows, placement);
    expect(r.warnings).toEqual([]);
    expect([r.columns, r.rowCount, r.tileCount]).toEqual([20, 6, 94]);
    expect(r.rows).toEqual(rows);
    expect(r.runs).toEqual(runs);
    expect(r.tile).toEqual(tile);
    expect(r.maxErrorMm).toBeLessThan(0.5);
    expect(r.placement.rotationDeg.x).toBeCloseTo(5, 2);
    expect(r.placement.rotationDeg.y).toBeCloseTo(30, 2);
    expect(r.placement.rotationDeg.z).toBeCloseTo(-2, 2);
    expect(r.placement.positionM.x).toBeCloseTo(1.5, 3);
    expect(r.placement.positionM.y).toBeCloseTo(0.2, 3);
    expect(r.placement.positionM.z).toBeCloseTo(-3, 3);
  });

  it("handles non-square tiles, other origins and a flat wall", () => {
    const tile = { tileWidthMm: 600, tileHeightMm: 337.5, tileResolutionX: 192, tileResolutionY: 108 };
    const runs = [{ columns: 12, angleBetweenTilesDeg: 0 }];
    const rows = Array.from({ length: 8 }, () => ({ startColumn: 0, columnCount: 12 }));
    const r = roundTrip(tile, runs, rows, { ...neutral, originX: "left", originY: "top", positionM: { x: -2, y: 4, z: 1 } });
    expect(r.tile).toEqual(tile);
    expect(r.runs).toEqual(runs);
    expect(r.maxErrorMm).toBeLessThan(0.5);
  });

  it("keeps empty rows and warns about gaps inside a row", () => {
    const tile = { tileWidthMm: 500, tileHeightMm: 500, tileResolutionX: 100, tileResolutionY: 100 };
    const rows: RowSpan[] = [
      { startColumn: 0, columnCount: 0 },
      { startColumn: 0, columnCount: 6 },
    ];
    const wall = buildWall({ name: "w", tile, runs: [{ columns: 6, angleBetweenTilesDeg: 0 }], rows, placement: neutral });
    const r = importObj(meshToObj(wall.mesh, "w"), { tileResolutionX: 100, tileResolutionY: 100 });
    expect(r.rows).toEqual(rows);

    // Remove the third tile of the bottom row → a gap.
    const lines = meshToObj(wall.mesh, "w").split("\n");
    const faces = lines.filter((l) => l.startsWith("f "));
    const gappy = lines.filter((l) => l !== faces[4] && l !== faces[5]).join("\n");
    const g = importObj(gappy, { tileResolutionX: 100, tileResolutionY: 100 });
    expect(g.rows[1]).toEqual({ startColumn: 0, columnCount: 6 });
    expect(g.warnings.join(" ")).toMatch(/Row 2 has gaps/);
  });

  it("reads quads, negative indices and refuses OBJs without UVs", () => {
    const quad = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "v 1 1 0", "vt 0 0", "vt 1 0", "vt 0 1", "vt 1 1", "f -4/-4 -3/-3 -1/-1 -2/-2"].join("\n");
    expect(parseObj(quad).triangles).toHaveLength(2);
    const r = importObj(quad, { tileResolutionX: 10, tileResolutionY: 10 });
    expect([r.columns, r.rowCount, r.tile.tileWidthMm, r.tile.tileHeightMm]).toEqual([1, 1, 1000, 1000]);
    expect(() => importObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3", { tileResolutionX: 1, tileResolutionY: 1 })).toThrow(/no UV/);
  });

  it("names the screen after the file", () => {
    expect(nameFromPath("objects/Mesh/Wall_V3.obj")).toBe("Wall_V3");
    expect(nameFromPath("C:\\temp\\screen.OBJ")).toBe("screen");
  });
});
