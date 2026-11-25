import { encodeRgbaPng } from "./mask";
import {
  COLOR_BARS,
  isTileLit,
  levelsSpec,
  PATTERN_ABSENT,
  tileColor,
  type LevelsSpec,
  type PatternPart,
  type Rgb,
  type TestPatternLayout,
} from "./testPattern";

/**
 * Browser-side drawing of a test pattern.
 *
 * A full 16384 × 2800 canvas would hold ~180 MB of pixels, so the PNG is drawn
 * in horizontal strips: each strip redraws the scene translated by its offset
 * (cheap: one rect per tile plus a few overlays) and its scanlines go straight
 * into the streaming PNG encoder.
 */

export interface PatternLogos {
  /** DisplayForge icon (square). */
  displayforge?: CanvasImageSource | null;
  /** Official Disguise logo, white version (plugin only). */
  disguise?: CanvasImageSource | null;
  /** Natural size of the Disguise logo, used to keep its aspect ratio. */
  disguiseSize?: { width: number; height: number };
}

/** Corner overlays (screen data, signature) are translucent so the pattern shows through. */
const OVERLAY_PLATE = "rgba(0,0,0,0.45)";
const OVERLAY_ALPHA = 0.85;
/** viewBox of the official landscape Disguise SVG, and the height of the logo inside it (y 20…74). */
const DISGUISE_BOX = { width: 292, height: 94 };
const DISGUISE_VISIBLE = 54;
const OVERLAY_TEXT = `rgba(255,255,255,${OVERLAY_ALPHA})`;
const FONT = '"Segoe UI", "Inter", Arial, sans-serif';
const css = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * Draw the area (vx, vy, vw, vh) of the full pattern, in pattern pixels, onto
 * `ctx` scaled by `scale` (1 for export, < 1 for the on-screen preview).
 */
export function drawTestPattern(
  ctx: CanvasRenderingContext2D,
  layout: TestPatternLayout,
  view: { x: number; y: number; width: number; height: number },
  scale: number,
  logos: PatternLogos = {},
): void {
  const { width: W, height: H, rows, totalColumns, tile } = layout;
  const tw = tile.tileResolutionX;
  const th = tile.tileResolutionY;

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -view.x * scale, -view.y * scale);
  ctx.fillStyle = css(PATTERN_ABSENT);
  ctx.fillRect(view.x, view.y, view.width, view.height);

  // Tiles visible in the view.
  const c0 = Math.max(0, Math.floor(view.x / tw));
  const c1 = Math.min(totalColumns - 1, Math.floor((view.x + view.width - 1) / tw));
  const r0 = Math.max(0, Math.floor(view.y / th));
  const r1 = Math.min(rows.length - 1, Math.floor((view.y + view.height - 1) / th));

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!isTileLit(rows, r, c)) continue;
      ctx.fillStyle = css(tileColor(r, c, layout.colors));
      ctx.fillRect(c * tw, r * th, tw, th);
    }
  }

  // Tile edges (1 px, inside the tile) and "<row>,<col>" labels on every tile.
  // The label is sized to fit the widest one ("<rows>,<columns>") in ~80 %
  // of the tile width, capped at 14 % of the tile height.
  const px = 1 / scale;
  ctx.font = `600 100px ${FONT}`;
  const widest = ctx.measureText(`${rows.length},${totalColumns}`).width || 1;
  const labelSize = Math.max(4, Math.min((tw * 0.8 * 100) / widest, th * 0.14));
  const showLabels = labelSize * scale >= 5; // export (scale 1) always; preview when readable
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = `600 ${labelSize}px ${FONT}`;
  ctx.lineJoin = "round";
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!isTileLit(rows, r, c)) continue;
      const x = c * tw;
      const y = r * th;
      if (scale >= 0.25) {
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(x, y, tw, Math.max(1, px));
        ctx.fillRect(x, y, Math.max(1, px), th);
      }
      if (showLabels) {
        const label = `${r + 1},${c + 1}`;
        const lx = x + Math.max(2, tw * 0.06);
        const ly = y + Math.max(2, th * 0.05);
        ctx.lineWidth = Math.max(1, labelSize * 0.18);
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, lx, ly);
      }
    }
  }

  // Geometry overlays on the whole screen: diagonals and the largest centred circle.
  const line = Math.max(1, Math.round(Math.min(W, H) / 900));
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = Math.max(line, px);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, H);
  ctx.moveTo(W, 0);
  ctx.lineTo(0, H);
  ctx.moveTo(W / 2 + Math.min(W, H) / 2 - line, H / 2);
  ctx.arc(W / 2, H / 2, Math.min(W, H) / 2 - line, 0, Math.PI * 2);
  ctx.stroke();
  // Centre cross.
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.stroke();

  // Screen name in the centre, optionally preceded by the Disguise logo and
  // followed by the colour bars and the legal / full range test. The whole
  // group is centred vertically and shrinks to fit short screens.
  const name = layout.screenName.trim() || "Screen";
  ctx.font = `700 100px ${FONT}`;
  const measured = ctx.measureText(name).width || 1;
  let nameSize = Math.max(8, Math.min((W * 0.6 * 100) / measured, H * 0.2));
  const levels = levelsSpec(layout.levels);
  let blockW = Math.min(W * 0.5, H * 1.2);
  let barsH = layout.colorBars ? blockW * 0.16 : 0;
  let levelsH = levels ? blockW * 0.24 : 0;
  let gap = nameSize * 0.2;
  // Disguise logo: the official landscape SVG on black, its built-in clear
  // space kept as the black margin; the visible logo is half the name height.
  const logoBox = logos.disguise ? logos.disguiseSize ?? DISGUISE_BOX : undefined;
  let logoH = logoBox ? ((nameSize * 0.5) / DISGUISE_VISIBLE) * logoBox.height : 0;
  const total = () => (logoH ? logoH + gap : 0) + nameSize + (barsH ? gap + barsH : 0) + (levelsH ? gap + levelsH : 0);
  const fit = (H * 0.85) / total();
  if (fit < 1) {
    nameSize *= fit;
    blockW *= fit;
    barsH *= fit;
    levelsH *= fit;
    logoH *= fit;
    gap *= fit;
  }
  let y = H / 2 - total() / 2;
  if (logos.disguise && logoBox && logoH) {
    const logoW = (logoH * logoBox.width) / logoBox.height;
    const lx = Math.round(W / 2 - logoW / 2);
    ctx.fillStyle = "#000";
    ctx.fillRect(lx, Math.round(y), Math.round(logoW), Math.round(logoH));
    ctx.drawImage(logos.disguise, lx, Math.round(y), Math.round(logoW), Math.round(logoH));
    y += logoH + gap;
  }
  ctx.font = `700 ${nameSize}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = nameSize * 0.12;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(name, W / 2, y + nameSize / 2);
  ctx.fillStyle = "#fff";
  ctx.fillText(name, W / 2, y + nameSize / 2);
  y += nameSize;
  const bx = Math.round(W / 2 - blockW / 2);
  if (barsH) {
    y += gap;
    drawColorBars(ctx, bx, Math.round(y), Math.round(blockW), Math.round(barsH));
    y += barsH;
  }
  if (levels && levelsH) {
    y += gap;
    drawLevels(ctx, levels, bx, Math.round(y), Math.round(blockW), Math.round(levelsH));
  }

  // Screen data, bottom-left of every file (each part of a split pattern).
  const unit = Math.round(Math.max(16, Math.min(160, Math.min(W, H) * 0.035)));
  for (const part of layout.parts) drawInfo(ctx, layout, part, unit);

  drawBranding(ctx, W, H, unit, logos);
  ctx.restore();
}

/** Whole-pixel edges of `n` equal cells over [start, start + size]. */
const cellEdges = (start: number, size: number, n: number) => Array.from({ length: n + 1 }, (_, i) => start + Math.round((i * size) / n));

/** Black frame around a block, so it reads on any tile colour. */
function frame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const m = Math.max(2, Math.round(w * 0.008));
  ctx.fillStyle = "#000";
  ctx.fillRect(x - m, y - m, w + m * 2, h + m * 2);
}

/** 75 % colour bars (top two thirds) over 100 % bars (bottom third). Values are exact 8-bit. */
function drawColorBars(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  frame(ctx, x, y, w, h);
  const xs = cellEdges(x, w, COLOR_BARS.length);
  const split = y + Math.round((h * 2) / 3);
  COLOR_BARS.forEach((bar, i) => {
    ctx.fillStyle = css(bar.rgb75);
    ctx.fillRect(xs[i], y, xs[i + 1] - xs[i], split - y);
    ctx.fillStyle = css(bar.rgb100);
    ctx.fillRect(xs[i], split, xs[i + 1] - xs[i], y + h - split);
  });
}

/**
 * Legal / full range test: a title strip, an 11-step grey scale from video
 * black to video white, then near-black patches on black and near-white
 * patches on white. Every patch is labelled with its 8-bit value.
 */
function drawLevels(ctx: CanvasRenderingContext2D, spec: LevelsSpec, x: number, y: number, w: number, h: number) {
  frame(ctx, x, y, w, h);
  const titleH = Math.round(h * 0.18);
  const stepsH = Math.round(h * 0.4);
  const patchY = y + titleH + stepsH;
  const patchH = y + h - patchY;
  const grey = (v: number) => `rgb(${v},${v},${v})`;
  const labelFont = (size: number) => `600 ${Math.max(4, size)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, w, titleH);
  ctx.fillStyle = "#fff";
  ctx.font = labelFont(Math.round(titleH * 0.62));
  ctx.fillText(spec.title, x + w / 2, y + titleH / 2);

  const sx = cellEdges(x, w, spec.steps.length);
  ctx.font = labelFont(Math.round(Math.min(stepsH * 0.22, (w / spec.steps.length) * 0.3)));
  spec.steps.forEach((v, i) => {
    ctx.fillStyle = grey(v);
    ctx.fillRect(sx[i], y + titleH, sx[i + 1] - sx[i], stepsH);
    ctx.fillStyle = v > 128 ? "#000" : "#fff";
    ctx.fillText(String(v), (sx[i] + sx[i + 1]) / 2, y + titleH + stepsH * 0.82);
  });

  const half = Math.round(w / 2);
  const groups: [number, number[], number][] = [
    [x, spec.blackPatches, spec.black],
    [x + half, spec.whitePatches, spec.white],
  ];
  for (const [gx, patches, bg] of groups) {
    const gw = gx === x ? half : w - half;
    ctx.fillStyle = grey(bg);
    ctx.fillRect(gx, patchY, gw, patchH);
    const px = cellEdges(gx, gw, patches.length);
    const size = Math.round(Math.min(patchH * 0.55, (gw / patches.length) * 0.7));
    ctx.font = labelFont(Math.round(Math.min(patchH * 0.18, size * 0.45)));
    patches.forEach((v, i) => {
      const cx = (px[i] + px[i + 1]) / 2;
      ctx.fillStyle = grey(v);
      ctx.fillRect(Math.round(cx - size / 2), Math.round(patchY + patchH * 0.12), size, size);
      ctx.fillStyle = "rgb(128,128,128)"; // mid grey: readable on both backgrounds, never part of the test
      ctx.fillText(String(v), cx, patchY + patchH * 0.86);
    });
  }
}

/** Resolution box at the bottom-left of a part: screen size, tile grid, tile size and (when split) the part. */
function drawInfo(ctx: CanvasRenderingContext2D, layout: TestPatternLayout, part: PatternPart, unit: number) {
  const { width: W, height: H, tile, totalColumns, rows } = layout;
  const lines = [
    `${W} × ${H} px`,
    `${totalColumns} × ${rows.length} tiles · tile ${tile.tileResolutionX} × ${tile.tileResolutionY} px`,
  ];
  if (part.label) {
    lines.push(`Part ${part.label}/${layout.parts.length} · ${part.width} × ${part.height} px · x ${part.x}–${part.x + part.width}, y ${part.y}–${part.y + part.height}`);
  }
  const big = Math.round(unit * 0.75);
  const small = Math.round(unit * 0.45);
  const pad = Math.round(unit * 0.4);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${big}px ${FONT}`;
  let boxW = ctx.measureText(lines[0]).width;
  ctx.font = `500 ${small}px ${FONT}`;
  for (const l of lines.slice(1)) boxW = Math.max(boxW, ctx.measureText(l).width);
  const boxH = big * 1.15 + (lines.length - 1) * small * 1.3;
  const x = part.x + unit * 0.5;
  const y = part.y + part.height - unit * 0.5 - boxH - pad * 2;
  if (boxW + pad * 2 > part.width - unit || y < part.y) return;
  ctx.fillStyle = OVERLAY_PLATE;
  ctx.fillRect(x, y, boxW + pad * 2, boxH + pad * 2);
  ctx.fillStyle = OVERLAY_TEXT;
  ctx.font = `700 ${big}px ${FONT}`;
  ctx.fillText(lines[0], x + pad, y + pad);
  ctx.font = `500 ${small}px ${FONT}`;
  lines.slice(1).forEach((l, i) => ctx.fillText(l, x + pad, y + pad + big * 1.15 + i * small * 1.3));
}

/**
 * Bottom-right signature: [DisplayForge icon] DisplayForge, directly on the
 * pattern at OVERLAY_ALPHA. The icon has rounded corners. (The Disguise logo
 * sits in the centre, above the screen name.)
 */
function drawBranding(ctx: CanvasRenderingContext2D, W: number, H: number, unit: number, logos: PatternLogos) {
  const pad = Math.round(unit * 0.5);
  const iconSize = unit;
  const textSize = Math.round(unit * 0.62);
  ctx.font = `600 ${textSize}px ${FONT}`;
  const text = "DisplayForge";
  const textW = ctx.measureText(text).width;
  const plateW = (logos.displayforge ? iconSize + pad * 0.5 : 0) + textW + pad * 2;
  const plateH = pad * 2 + iconSize;
  const px = W - plateW - pad;
  const py = H - plateH - pad;
  if (px < 0 || py < 0) return;

  const cy = py + plateH / 2;
  ctx.globalAlpha = OVERLAY_ALPHA;
  let x = px + pad;
  if (logos.displayforge) {
    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, x, cy - iconSize / 2, iconSize, iconSize, iconSize * 0.22);
    ctx.clip();
    ctx.drawImage(logos.displayforge, x, cy - iconSize / 2, iconSize, iconSize);
    ctx.restore();
    x += iconSize + pad * 0.5;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = textSize * 0.14;
  ctx.strokeStyle = "rgba(0,0,0,0.7)"; // keeps the wordmark legible on Y / C cells
  ctx.strokeText(text, x, cy);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, cy);
  ctx.globalAlpha = 1;
}

/** Rounded-rectangle path; arcTo fallback for browsers without ctx.roundRect. */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const STRIP = 256;

/** Render one part at full resolution and encode it as PNG, strip by strip. */
export async function renderPatternPart(
  layout: TestPatternLayout,
  part: PatternPart,
  logos: PatternLogos,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = part.width;
  canvas.height = Math.min(STRIP, part.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot draw the test pattern (no 2D canvas).");
  const stride = 1 + part.width * 4;

  return encodeRgbaPng(part.width, part.height, async (write) => {
    for (let y = 0; y < part.height; y += STRIP) {
      const h = Math.min(STRIP, part.height - y);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawTestPattern(ctx, layout, { x: part.x, y: part.y + y, width: part.width, height: h }, 1, logos);
      const data = ctx.getImageData(0, 0, part.width, h).data;
      for (let line = 0; line < h; line++) {
        const out = new Uint8Array(stride); // filter 0 ("None")
        out.set(data.subarray(line * part.width * 4, (line + 1) * part.width * 4), 1);
        await write(out);
      }
      onProgress?.(Math.min(1, (y + h) / part.height));
    }
  });
}

/** Load an image from a URL, or null when it is missing (e.g. no Disguise logo installed). */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
