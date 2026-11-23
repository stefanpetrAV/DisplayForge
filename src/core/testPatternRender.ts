import { encodeRgbaPng } from "./mask";
import { isTileLit, PATTERN_ABSENT, tileColor, type PatternPart, type Rgb, type TestPatternLayout } from "./testPattern";

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
      ctx.fillStyle = css(tileColor(r, c));
      ctx.fillRect(c * tw, r * th, tw, th);
    }
  }

  // Tile edges (1 px, inside the tile) and "row,col" labels.
  const px = 1 / scale;
  const labelSize = Math.round(Math.min(tw, th) * 0.13);
  const showLabels = labelSize * scale >= 7;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = `600 ${labelSize}px ${FONT}`;
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
        ctx.fillStyle = "#fff";
        ctx.fillText(`${r + 1},${c + 1}`, x + labelSize * 0.35, y + labelSize * 0.3);
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

  // Screen name in the centre.
  const name = layout.screenName.trim() || "Screen";
  ctx.font = `700 100px ${FONT}`;
  const measured = ctx.measureText(name).width || 1;
  const nameSize = Math.max(8, Math.min((W * 0.6 * 100) / measured, H * 0.2));
  ctx.font = `700 ${nameSize}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = nameSize * 0.12;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(name, W / 2, H / 2);
  ctx.fillStyle = "#fff";
  ctx.fillText(name, W / 2, H / 2);

  // Resolution, bottom-left.
  const unit = Math.round(Math.max(16, Math.min(160, Math.min(W, H) * 0.035)));
  ctx.font = `600 ${Math.round(unit * 0.6)}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = unit * 0.12;
  ctx.strokeText(`${W} × ${H}`, unit * 0.5, H - unit * 0.5);
  ctx.fillText(`${W} × ${H}`, unit * 0.5, H - unit * 0.5);

  drawBranding(ctx, W, H, unit, logos);
  ctx.restore();
}

/**
 * Bottom-right signature: [Disguise logo]  [DisplayForge icon] DisplayForge.
 * Both sit on one black plate. The Disguise logo is used unmodified, white on
 * black, at least 15 px high, with a clear space of half its height around
 * it (brand.disguise.one: black or white only, no outline/shadow/rotation).
 */
function drawBranding(ctx: CanvasRenderingContext2D, W: number, H: number, unit: number, logos: PatternLogos) {
  const pad = Math.round(unit * 0.5);
  const iconSize = unit;
  const textSize = Math.round(unit * 0.62);
  ctx.font = `600 ${textSize}px ${FONT}`;
  const text = "DisplayForge";
  const textW = ctx.measureText(text).width;
  const dfW = (logos.displayforge ? iconSize + pad * 0.5 : 0) + textW;

  let dgW = 0;
  const dgH = Math.max(15, Math.round(unit * 0.8));
  if (logos.disguise) {
    const s = logos.disguiseSize;
    dgW = s && s.height > 0 ? (dgH * s.width) / s.height : dgH * 4;
  }
  const gap = logos.disguise ? pad * 2 : 0; // ≥ clear space of both marks
  const plateW = pad * 2 + dgW + gap + dfW;
  const plateH = pad * 2 + Math.max(iconSize, dgH);
  const px = W - plateW - pad;
  const py = H - plateH - pad;
  if (px < 0 || py < 0) return;

  ctx.fillStyle = "#000";
  ctx.fillRect(px, py, plateW, plateH);
  const cy = py + plateH / 2;
  let x = px + pad;
  if (logos.disguise) {
    ctx.drawImage(logos.disguise, x, cy - dgH / 2, dgW, dgH);
    x += dgW + gap;
  }
  if (logos.displayforge) {
    ctx.drawImage(logos.displayforge, x, cy - iconSize / 2, iconSize, iconSize);
    x += iconSize + pad * 0.5;
  }
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, cy);
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
