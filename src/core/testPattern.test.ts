import { describe, expect, it } from "vitest";
import { levelsSpec, splitAxis, testPatternFileName, testPatternLayout, tileColorName } from "./testPattern";
import { sanitizeTestPattern } from "./sanitize";

const tile = (x: number, y: number) => ({ tileWidthMm: 500, tileHeightMm: 500, tileResolutionX: x, tileResolutionY: y });
const full = (cols: number, rows: number) => Array.from({ length: rows }, () => ({ startColumn: 0, columnCount: cols }));

describe("test pattern colours", () => {
  it("gives every column one colour, alternating with grey", () => {
    const colors = ["R", "G", "B", "Y", "C", "M"] as const;
    for (let c = 0; c < 14; c++) {
      const inColumn = new Set<string>();
      for (let r = 0; r < 10; r++) {
        const name = tileColorName(r, c, [...colors]);
        expect(name === null).toBe((r + c) % 2 === 0);
        if (name) inColumn.add(name);
      }
      expect([...inColumn]).toEqual([colors[c % 6]]);
    }
  });
  it("cycles through the selected colours only", () => {
    const picked = [0, 1, 2, 3, 4, 5].map((c) => tileColorName(c % 2 === 0 ? 1 : 0, c, ["R", "C"]));
    expect(picked).toEqual(["R", "C", "R", "C", "R", "C"]);
    expect(tileColorName(0, 7, ["M"])).toBe("M");
  });
  it("keeps the selection in RGBYCM order and never empty", () => {
    expect(sanitizeTestPattern({ colors: ["M", "R", "R", "X" as never] }).colors).toEqual(["R", "M"]);
    expect(sanitizeTestPattern({ colors: [] }).colors).toEqual(["R", "G", "B", "Y", "C", "M"]);
    expect(sanitizeTestPattern(undefined).colors).toHaveLength(6);
  });
  it("defaults to no colour bars and no range test", () => {
    expect(sanitizeTestPattern(undefined)).toMatchObject({ colorBars: false, levels: "off" });
    expect(sanitizeTestPattern({ colorBars: true, levels: "legal" })).toMatchObject({ colorBars: true, levels: "legal" });
    expect(sanitizeTestPattern({ levels: "bogus" as never }).levels).toBe("off");
  });
});

describe("legal / full range test", () => {
  it("has no test when off", () => expect(levelsSpec("off")).toBeNull());
  it("legal: steps 16…235, patches straddle video black and white", () => {
    const l = levelsSpec("legal")!;
    expect([l.steps[0], l.steps[10], l.steps.length]).toEqual([16, 235, 11]);
    expect(l.blackPatches.some((v) => v < 16) && l.blackPatches.some((v) => v > 16)).toBe(true);
    expect(l.whitePatches.some((v) => v < 235) && l.whitePatches.some((v) => v > 235)).toBe(true);
  });
  it("full: steps 0…255, every patch inside the range and distinct from its background", () => {
    const f = levelsSpec("full")!;
    expect([f.steps[0], f.steps[10]]).toEqual([0, 255]);
    expect(f.blackPatches.every((v) => v > 0 && v <= 255)).toBe(true);
    expect(f.whitePatches.every((v) => v >= 0 && v < 255)).toBe(true);
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
