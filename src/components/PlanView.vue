<script setup lang="ts">
/**
 * Top-down plan (looking down -Y): +X to the right, +Z (front / audience)
 * towards the bottom. Uses the same world-space points as the mesh, so it
 * always matches the 3D preview and the exported OBJ.
 */
import { computed } from "vue";
import type { Point3 } from "../core/wall";

const props = defineProps<{ walls: Array<{ id: string; isActive: boolean; points: Point3[] }> }>();

const W = 400;
const H = 180;
const PAD = 22;

const view = computed(() => {
  const all = props.walls.flatMap((w) => w.points);
  if (all.length === 0) return null;
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0; // always include the world origin
  for (const [x, , z] of all) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const spanX = Math.max(0.001, maxX - minX);
  const spanZ = Math.max(0.001, maxZ - minZ);
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanZ);
  const offX = PAD + (W - 2 * PAD - spanX * scale) / 2;
  const offZ = PAD + (H - 2 * PAD - spanZ * scale) / 2;
  const map = (x: number, z: number) => [offX + (x - minX) * scale, offZ + (z - minZ) * scale] as const;
  const lines = props.walls.map((w) => ({
    id: w.id,
    isActive: w.isActive,
    points: w.points.map(([x, , z]) => map(x, z).map((n) => n.toFixed(1)).join(",")).join(" "),
    start: map(w.points[0]?.[0] ?? 0, w.points[0]?.[2] ?? 0),
  }));
  return { lines, origin: map(0, 0), scale };
});
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="plan">
    <text x="6" y="12" class="label">Back</text>
    <text x="6" :y="H - 5" class="label">Front / audience (+Z)</text>
    <template v-if="view">
      <g class="origin">
        <line :x1="view.origin[0] - 5" :y1="view.origin[1]" :x2="view.origin[0] + 5" :y2="view.origin[1]" />
        <line :x1="view.origin[0]" :y1="view.origin[1] - 5" :x2="view.origin[0]" :y2="view.origin[1] + 5" />
      </g>
      <g v-for="l in view.lines" :key="l.id">
        <polyline :points="l.points" fill="none" :class="l.isActive ? 'wall active' : 'wall'" />
        <circle :cx="l.start[0]" :cy="l.start[1]" r="2.5" :class="l.isActive ? 'start active' : 'start'">
          <title>Column 1 (left end seen from the front)</title>
        </circle>
      </g>
    </template>
  </svg>
</template>

<style scoped>
.plan { width: 100%; height: 160px; background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px; }
.label { font-size: 9px; fill: var(--text-muted); }
.wall { stroke: var(--text-muted); stroke-width: 2; opacity: 0.7; }
.wall.active { stroke: var(--accent); opacity: 1; }
.start { fill: var(--text-muted); }
.start.active { fill: var(--accent); }
.origin line { stroke: var(--text-secondary); stroke-width: 1; }
</style>
