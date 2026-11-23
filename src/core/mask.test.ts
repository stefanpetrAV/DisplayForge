import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { clipToScreen, encodeMaskPng, litTileCount, maskFileName, maskLayout, MAX_TEXTURE_SIDE, tilePixelRange } from "./mask";
import { sanitizeProject } from "./screen";
import type { RowSpan } from "./types";

/** Decode an 8-bit RGBA PNG written by encodeMaskPng (filters None and Up only). */
function decode(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  let width = 0, height = 0;
  const idat: Uint8Array[] = [];
  while (offset < png.length) {
    const len = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 4;
  expect(raw.length).toBe(stride * height);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    for (let i = 0; i < width * 4; i++) {
      const v = raw[y * stride + 1 + i];
      const up = y > 0 ? pixels[(y - 1) * width * 4 + i] : 0;
      pixels[y * width * 4 + i] = filter === 2 ? (v + up) & 0xff : v;
    }
  }
  return { width, height, at: (x: number, y: number) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)] };
}

const tile = { tileWidthMm: 500, tileHeightMm: 500, tileResolutionX: 4, tileResolutionY: 3 };

describe("population mask layout", () => {
  it("clips a variant to the tiles that exist in the mesh", () => {
    const screen: RowSpan[] = [
      { startColumn: 2, columnCount: 4 },
      { startColumn: 0, columnCount: 8 },
    ];
    const variant: RowSpan[] = [
      { startColumn: 0, columnCount: 8 },
      { startColumn: 6, columnCount: 0 },
    ];
    expect(clipToScreen(screen, variant)).toEqual([
      { startColumn: 2, columnCount: 4 },
      { startColumn: 0, columnCount: 0 }, // empty row: no tiles lit
    ]);
    // Rows the variant does not know yet follow the screen.
    expect(clipToScreen(screen, variant.slice(0, 1))[1]).toEqual(screen[1]);
  });

  it("uses the screen resolution up to 16384 px, with every tile exactly its resolution", () => {
    const rows = Array.from({ length: 4 }, () => ({ startColumn: 0, columnCount: 10 }));
    const l = maskLayout(10, rows, { ...tile, tileResolutionX: 176, tileResolutionY: 352 });
    expect([l.width, l.height, l.scaled]).toEqual([1760, 1408, false]);
    expect(tilePixelRange(l)).toEqual({ minW: 176, maxW: 176, minH: 352, maxH: 352 });
  });

  it("scales larger screens proportionally so the long side is exactly 16384 px", () => {
    const rows = Array.from({ length: 15 }, () => ({ startColumn: 0, columnCount: 84 }));
    const l = maskLayout(84, rows, { ...tile, tileResolutionX: 200, tileResolutionY: 200 });
    expect([l.width, l.height, l.scaled]).toEqual([16384, 2926, true]);
    expect(l.width / l.height).toBeCloseTo(16800 / 3000, 2);
    expect(tilePixelRange(l)).toEqual({ minW: 195, maxW: 196, minH: 195, maxH: 196 });
    // Edges sit on the whole pixel nearest to the exact UV position.
    l.columnEdges.forEach((x, c) => expect(Math.abs(x - (c / 84) * l.width)).toBeLessThanOrEqual(0.5));
    l.rowEdges.forEach((y, r) => expect(Math.abs(y - (r / 15) * l.height)).toBeLessThanOrEqual(0.5));
  });

  it("keeps the proportions of non-square tiles and of tall screens", () => {
    const wide = maskLayout(100, Array.from({ length: 10 }, () => ({ startColumn: 0, columnCount: 100 })), {
      ...tile,
      tileResolutionX: 192,
      tileResolutionY: 384,
    });
    expect(wide.width).toBe(MAX_TEXTURE_SIDE); // 19200 × 3840 → 16384 × 3277
    expect(wide.height).toBe(Math.round(3840 * (MAX_TEXTURE_SIDE / 19200)));
    const tall = maskLayout(4, Array.from({ length: 120 }, () => ({ startColumn: 0, columnCount: 4 })), {
      ...tile,
      tileResolutionX: 256,
      tileResolutionY: 168,
    });
    expect([tall.width, tall.height]).toEqual([Math.round(1024 * (MAX_TEXTURE_SIDE / 20160)), MAX_TEXTURE_SIDE]);
  });

  it("names files after the screen and the variant", () => {
    expect(maskFileName("Wall V3")).toBe("wall-v3_population");
    expect(maskFileName("Wall V3", "14 rows")).toBe("wall-v3_14-rows");
  });
});

describe("population mask PNG", () => {
  const rows: RowSpan[] = [
    { startColumn: 1, columnCount: 1 },
    { startColumn: 0, columnCount: 3 },
  ];

  it("draws lit tiles white and absent tiles transparent, on whole pixels", async () => {
    const png = decode(await encodeMaskPng(maskLayout(3, rows, tile), "transparent"));
    expect([png.width, png.height]).toEqual([12, 6]);
    expect(png.at(3, 0)).toEqual([0, 0, 0, 0]); // last pixel of absent tile 0
    expect(png.at(4, 0)).toEqual([255, 255, 255, 255]); // first pixel of lit tile 1
    expect(png.at(7, 2)).toEqual([255, 255, 255, 255]); // last pixel of tile 1, last line of row 0
    expect(png.at(8, 2)).toEqual([0, 0, 0, 0]);
    expect(png.at(0, 3)).toEqual([255, 255, 255, 255]); // row 1 fully lit
    expect(png.at(11, 5)).toEqual([255, 255, 255, 255]);
  });

  it("keeps hard edges when the mask is scaled down", async () => {
    // 84 × 15 tiles of 200 px → 16384 × 2926; top row: only tile 40 lit.
    const big: RowSpan[] = [{ startColumn: 40, columnCount: 1 }, ...Array.from({ length: 14 }, () => ({ startColumn: 0, columnCount: 84 }))];
    const l = maskLayout(84, big, { ...tile, tileResolutionX: 200, tileResolutionY: 200 });
    const png = decode(await encodeMaskPng(l, "transparent"));
    expect([png.width, png.height]).toEqual([16384, 2926]);
    const [x0, x1] = [l.columnEdges[40], l.columnEdges[41]];
    expect(png.at(x0 - 1, 0)).toEqual([0, 0, 0, 0]);
    expect(png.at(x0, 0)).toEqual([255, 255, 255, 255]);
    expect(png.at(x1 - 1, l.rowEdges[1] - 1)).toEqual([255, 255, 255, 255]);
    expect(png.at(x1, 0)).toEqual([0, 0, 0, 0]);
    expect(png.at(0, l.rowEdges[1])).toEqual([255, 255, 255, 255]);
  });

  it("can write absent tiles as opaque black", async () => {
    const png = decode(await encodeMaskPng(maskLayout(3, rows, tile), "black"));
    expect(png.at(0, 0)).toEqual([0, 0, 0, 255]);
  });

  it("reproduces the ANCI 15-row wall and its 14-row variant", async () => {
    // 84 × 15 tiles; the top three rows are centred spans of 9, 24 and 30 tiles.
    const centred = (n: number) => ({ startColumn: (84 - n) / 2, columnCount: n });
    const wall: RowSpan[] = [centred(10), centred(24), centred(30), ...Array.from({ length: 12 }, () => centred(84))];
    wall[0] = { startColumn: 37, columnCount: 9 };
    // 14-row configuration: top row off, then 20, 28 and full rows.
    const variant: RowSpan[] = [{ startColumn: 37, columnCount: 0 }, centred(20), centred(28), ...wall.slice(3)];
    const lit = clipToScreen(wall, variant);
    expect(litTileCount(wall)).toBe(1071);
    expect(litTileCount(lit)).toBe(1056);
    const png = decode(await encodeMaskPng(maskLayout(84, lit, { ...tile, tileResolutionX: 2, tileResolutionY: 2 }), "black"));
    expect([png.width, png.height]).toEqual([168, 30]);
    expect(png.at(84, 0)).toEqual([0, 0, 0, 255]); // top row off
    expect(png.at(32 * 2, 2)).toEqual([255, 255, 255, 255]); // first tile of the 20-wide row
    expect(png.at(31 * 2 + 1, 2)).toEqual([0, 0, 0, 255]);
  });
});

describe("saved projects", () => {
  it("loads 0.6 screens without populations and keeps 0.7 variants", () => {
    const old = sanitizeProject({ version: 1, activeId: "a", screens: [{ id: "a", name: "Wall", rows: [{ startColumn: 0, columnCount: 2 }], runs: [{ columns: 2 }] }] });
    expect(old!.screens[0].populations).toEqual([]);
    expect(old!.screens[0].mask).toEqual({ absent: "transparent", assignToScreen: true });

    const saved = JSON.parse(JSON.stringify(old));
    saved.screens[0].populations = [{ id: "v", name: "Half", rows: [{ startColumn: 0, columnCount: 1 }] }];
    saved.screens[0].mask.absent = "black";
    const again = sanitizeProject(saved)!.screens[0];
    expect(again.populations).toEqual([{ id: "v", name: "Half", rows: [{ startColumn: 0, columnCount: 1 }] }]);
    expect(again.mask.absent).toBe("black");
  });
});
