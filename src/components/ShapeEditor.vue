<script setup lang="ts">
import { computed } from "vue";
import type { RowSpan, ShapeSettings } from "../core/types";
import NumField from "./NumField.vue";

const props = defineProps<{
  rows: RowSpan[];
  shape: ShapeSettings;
  totalColumns: number;
}>();
const emit = defineEmits<{
  shape: [patch: Partial<ShapeSettings>];
  rowCount: [count: number];
  row: [index: number, patch: Partial<RowSpan>];
}>();

const CELL = 10;
const width = computed(() => Math.max(1, props.totalColumns) * CELL);
const height = computed(() => Math.max(1, props.rows.length) * CELL);

/** One rect per populated span (rows[0] drawn at the top, as in the 3D view and in Designer). */
const spans = computed(() =>
  props.rows.map((r, i) => ({ x: r.startColumn * CELL, y: i * CELL, w: r.columnCount * CELL })),
);

function onKind(e: Event) {
  emit("shape", { kind: (e.target as HTMLSelectElement).value as ShapeSettings["kind"] });
}
</script>

<template>
  <div class="shape-editor">
    <div class="controls">
      <label class="field">
        <span>Shape</span>
        <select :value="shape.kind" @change="onKind">
          <option value="rectangle">Rectangle (full)</option>
          <option value="triangle">Triangle</option>
          <option value="circle">Circle</option>
          <option value="diamond">Diamond</option>
          <option value="custom">Custom (manual rows)</option>
        </select>
      </label>
      <NumField label="Rows" :model-value="rows.length" :min="1" :max="2000" integer @update:model-value="emit('rowCount', $event)" />
      <template v-if="shape.kind === 'triangle'">
        <NumField
          label="Base columns"
          :model-value="shape.triangleBaseColumns"
          :min="1"
          integer
          @update:model-value="emit('shape', { triangleBaseColumns: $event })"
        />
        <label class="field">
          <span>Apex</span>
          <select :value="shape.triangleApex" @change="emit('shape', { triangleApex: ($event.target as HTMLSelectElement).value as 'top' | 'bottom' })">
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
      </template>
      <NumField
        v-if="shape.kind === 'circle'"
        label="Diameter (columns)"
        :model-value="shape.circleDiameterColumns"
        :min="1"
        integer
        @update:model-value="emit('shape', { circleDiameterColumns: $event })"
      />
      <NumField
        v-if="shape.kind === 'diamond'"
        label="Max columns"
        :model-value="shape.diamondWidthColumns"
        :min="1"
        integer
        @update:model-value="emit('shape', { diamondWidthColumns: $event })"
      />
      <label v-if="shape.kind === 'triangle' || shape.kind === 'circle' || shape.kind === 'diamond'" class="check">
        <input type="checkbox" :checked="shape.autoFit" @change="emit('shape', { autoFit: ($event.target as HTMLInputElement).checked })" />
        Auto-fit size
      </label>
    </div>

    <div class="grid-wrap">
      <span class="edge-label">Top · front view</span>
      <svg :viewBox="`0 0 ${width} ${height}`" class="grid-preview" preserveAspectRatio="xMidYMid meet" :style="{ aspectRatio: `${width} / ${height}` }">
        <defs>
          <pattern id="df-cell" :width="CELL" :height="CELL" patternUnits="userSpaceOnUse">
            <rect :width="CELL - 1" :height="CELL - 1" fill="var(--panel-alt)" />
          </pattern>
          <pattern id="df-cell-on" :width="CELL" :height="CELL" patternUnits="userSpaceOnUse">
            <rect :width="CELL - 1" :height="CELL - 1" fill="var(--accent)" />
          </pattern>
        </defs>
        <rect x="0" y="0" :width="width" :height="height" fill="url(#df-cell)" />
        <rect v-for="(s, i) in spans" :key="i" :x="s.x" :y="s.y" :width="s.w" :height="CELL" fill="url(#df-cell-on)" />
      </svg>
      <span class="edge-label">Bottom</span>
    </div>

    <details class="row-table">
      <summary>Fine-tune rows manually ({{ rows.length }}) — Row 1 is the top row</summary>
      <div v-for="(row, i) in rows" :key="i" class="row-line">
        <span class="row-index">Row {{ i + 1 }}<template v-if="i === 0"> (top)</template><template v-else-if="i === rows.length - 1"> (bottom)</template></span>
        <NumField label="Start column" :model-value="row.startColumn" :min="0" :max="totalColumns" integer @update:model-value="emit('row', i, { startColumn: $event })" />
        <NumField label="Column count" :model-value="row.columnCount" :min="0" :max="totalColumns" integer @update:model-value="emit('row', i, { columnCount: $event })" />
      </div>
    </details>
  </div>
</template>

<style scoped>
.shape-editor { display: flex; flex-direction: column; gap: 10px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; }
.controls :deep(input[type="number"]) { width: 90px; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); padding-bottom: 6px; }
.grid-wrap { display: flex; flex-direction: column; gap: 2px; }
.edge-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.grid-preview { width: 100%; max-height: 220px; background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px; }
.row-table { font-size: 12px; color: var(--text-secondary); }
.row-table summary { cursor: pointer; color: var(--accent); margin-bottom: 6px; }
.row-line { display: flex; align-items: flex-end; gap: 8px; padding: 4px 0; border-top: 1px solid var(--border); }
.row-line :deep(input) { width: 90px; }
.row-index { width: 92px; font-size: 11px; color: var(--text-muted); padding-bottom: 6px; }
</style>
