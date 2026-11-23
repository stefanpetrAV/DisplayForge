import { describe, expect, it } from "vitest";
import { splitAxis, testPatternFileName, testPatternLayout, tileColorIndex } from "./testPattern";

const tile = (x: number, y: number) => ({ tileWidthMm: 500, tileHeightMm: 500, tileResolutionX: x, tileResolutionY: y });
const full = (cols: number, rows: number) => Array.from({ length: rows }, () => ({ startColumn: 0, columnCount: cols }));

describe("test pattern colours", () => {
  it("alternates grey with RGBYCM and never repeats a colour on touching tiles", () => {
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 12; c++) {
        const i = tileColorIndex(r, c);
        expect(i < 0).toBe((r + c) % 2 === 0);
        if (i < 0) continue;
        for (const [dr, dc] of [[1, 1], [1, -1], [0, 2], [2, 0]]) expect(tileColorIndex(r + dr, c + dc)).not.toBe(i);
      }
    }
  });
  it("uses all six colours", () => {
    const seen = new Set<number>();
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) seen.add(tileColorIndex(r, c));
    expect([...seen].filter((i) => i >= 0).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("test pattern split", () => {
  it("keeps one image up to 16384 px and splits 16800 px", () => {
    const l = testPatternLayout("ANCI", 84, full(84, 14), tile(200, 200));
    expect(l.width).toBe(16800);
    expect(l.parts).toHaveLength(2);
    const small = testPatternLayout("Out 1", 14, full(14, 14), tile(200, 200));
    expect(small.parts).toEqual([{ label: "", x: 0, y: 0, width: 2800, height: 2800 }]);
    expect(testPatternFileName("Out 1", small.parts[0])).toBe("out-1_testpattern");
  });
  it("splits in half on tile edges above 16384 px", () => {
    const l = testPatternLayout("ANCI", 84, full(84, 14), tile(200, 200));
    expect(l.parts.map((p) => [p.label, p.x, p.width])).toEqual([["A", 0, 8400], ["B", 8400, 8400]]);
    expect(testPatternFileName("ANCI", l.parts[1])).toBe("anci_testpattern_b");
  });
  it("splits an odd tile count on the nearest tile edge", () => {
    expect(splitAxis(85 * 200, 200)).toEqual([[0, 8600], [8600, 8400]]);
  });
  it("uses as many parts as needed and splits heights too", () => {
    expect(splitAxis(40000, 100).map((p) => p[1])).toEqual([13300, 13400, 13300]);
    const tall = testPatternLayout("Tower", 10, full(10, 100), tile(192, 192));
    expect(tall.parts.map((p) => [p.label, p.y, p.height])).toEqual([["A", 0, 9600], ["B", 9600, 9600]]);
  });
});
