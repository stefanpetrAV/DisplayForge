<script setup lang="ts">
import { computed } from "vue";
import type { MaskSettings, PopulationVariant, RowSpan, TileSpec } from "../core/types";
import { MAX_TEXTURE_SIDE, clipToScreen, litTileCount, maskFileName, maskLayout, tilePixelRange } from "../core/mask";
import NumField from "./NumField.vue";

const props = defineProps<{
  screenName: string;
  rows: RowSpan[];
  totalColumns: number;
  tile: TileSpec;
  populations: PopulationVariant[];
  mask: MaskSettings;
  isPlugin: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  mask: [patch: Partial<MaskSettings>];
  add: [];
  duplicate: [id: string];
  remove: [id: string];
  rename: [id: string, name: string];
  reset: [id: string];
  row: [id: string, index: number, patch: Partial<RowSpan>];
  rowLit: [id: string, index: number, lit: boolean];
  generate: [variantId: string | null];
}>();

const CELL = 10;
const width = computed(() => Math.max(1, props.totalColumns) * CELL);
const height = computed(() => Math.max(1, props.rows.length) * CELL);

/** Mesh tiles (dim) — the variant's lit tiles are drawn on top. */
const meshSpans = computed(() => props.rows.map((r, i) => ({ x: r.startColumn * CELL, y: i * CELL, w: r.columnCount * CELL })));

const layout = computed(() => maskLayout(props.totalColumns, props.rows, props.tile));
const range = computed(() => tilePixelRange(layout.value));
const span = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);
const tileSize = computed(() => `${span(range.value.minW, range.value.maxW)} × ${span(range.value.minH, range.value.maxH)} px`);

const entries = computed(() => [
  { id: null as string | null, name: "Screen shape", rows: props.rows, variant: null as PopulationVariant | null },
  ...props.populations.map((p) => ({ id: p.id as string | null, name: p.name, rows: clipToScreen(props.rows, p.rows), variant: p })),
]);

function spansOf(rows: RowSpan[]) {
  return rows.map((r, i) => ({ x: r.startColumn * CELL, y: i * CELL, w: r.columnCount * CELL }));
}

const actionLabel = computed(() => (props.isPlugin ? (props.mask.assignToScreen ? "Save + assign mask" : "Save mask") : "Download mask"));
</script>

<template>
  <div class="masks">
    <p class="hint">
      A population mask tells disguise which pixels of the LED screen exist. Each variant lights a subset of the mesh tiles,
      e.g. the 14-row configuration of a 15-row wall, and is exported on the same UV grid as the mesh.
    </p>

    <div class="controls">
      <label class="field">
        <span>Absent tiles</span>
        <select :value="mask.absent" @change="emit('mask', { absent: ($event.target as HTMLSelectElement).value as MaskSettings['absent'] })">
          <option value="transparent">Transparent (not there)</option>
          <option value="black">Black (there, switched off)</option>
        </select>
      </label>
      <label v-if="isPlugin" class="check">
        <input type="checkbox" :checked="mask.assignToScreen" @change="emit('mask', { assignToScreen: ($event.target as HTMLInputElement).checked })" />
        Set as the LED screen's population mask
      </label>
    </div>

    <p class="hint">
      Mask: <strong>{{ layout.width }} × {{ layout.height }} px</strong> ({{ tileSize }} per tile)
      · LED screen {{ layout.screenWidth }} × {{ layout.screenHeight }} px
    </p>
    <p v-if="layout.scaled" class="warn">
      The screen is larger than {{ MAX_TEXTURE_SIDE }} px: the mask is scaled down proportionally so its long side is {{ MAX_TEXTURE_SIDE }} px.
      Tile edges stay on whole pixels, so neighbouring tiles can differ by 1 px.
    </p>

    <div v-for="entry in entries" :key="entry.id ?? 'screen'" class="entry">
      <div class="entry-head">
        <input
          v-if="entry.variant"
          type="text"
          class="name"
          :value="entry.name"
          @change="emit('rename', entry.variant.id, ($event.target as HTMLInputElement).value)"
        />
        <strong v-else class="name">{{ entry.name }}</strong>
        <span class="count">{{ litTileCount(entry.rows) }} tiles</span>
      </div>
      <svg :viewBox="`0 0 ${width} ${height}`" class="grid-preview" preserveAspectRatio="xMidYMid meet" :style="{ aspectRatio: `${width} / ${height}` }">
        <rect x="0" y="0" :width="width" :height="height" fill="var(--input-bg)" />
        <rect v-for="(s, i) in meshSpans" :key="`m${i}`" :x="s.x" :y="s.y" :width="s.w" :height="CELL" fill="var(--panel-alt)" />
        <rect v-for="(s, i) in spansOf(entry.rows)" :key="`l${i}`" :x="s.x" :y="s.y" :width="s.w" :height="CELL" fill="#f2f2f2" />
      </svg>
      <p class="hint">
        <code>{{ maskFileName(screenName, entry.variant?.name) }}.png</code>
      </p>
      <div class="buttons">
        <button type="button" class="primary" :disabled="busy" @click="emit('generate', entry.id)">{{ actionLabel }}</button>
        <template v-if="entry.variant">
          <button type="button" class="ghost" @click="emit('duplicate', entry.variant.id)">Duplicate</button>
          <button type="button" class="ghost" @click="emit('reset', entry.variant.id)">Reset to shape</button>
          <button type="button" class="ghost danger" @click="emit('remove', entry.variant.id)">Remove</button>
        </template>
      </div>
      <details v-if="entry.variant" class="row-table">
        <summary>Edit rows ({{ rows.length }}) — Row 1 is the top row</summary>
        <div v-for="(row, i) in entry.rows" :key="i" class="row-line">
          <label class="check row-index">
            <input
              type="checkbox"
              :checked="row.columnCount > 0"
              :disabled="rows[i].columnCount === 0"
              @change="emit('rowLit', entry.variant.id, i, ($event.target as HTMLInputElement).checked)"
            />
            Row {{ i + 1 }}
          </label>
          <NumField
            label="Start column"
            :model-value="row.startColumn"
            :min="rows[i].startColumn"
            :max="rows[i].startColumn + rows[i].columnCount"
            integer
            @update:model-value="emit('row', entry.variant.id, i, { startColumn: $event })"
          />
          <NumField
            label="Column count"
            :model-value="row.columnCount"
            :min="0"
            :max="rows[i].columnCount"
            integer
            @update:model-value="emit('row', entry.variant.id, i, { columnCount: $event })"
          />
        </div>
      </details>
    </div>

    <button type="button" class="ghost" @click="emit('add')">+ Add population variant</button>
  </div>
</template>

<style scoped>
.masks { display: flex; flex-direction: column; gap: 10px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; }
.check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); padding-bottom: 6px; }
.warn { font-size: 11px; color: #e0b050; }
.entry { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); }
.entry-head { display: flex; align-items: center; gap: 8px; }
.entry-head .name { flex: 1; min-width: 0; }
.count { font-size: 11px; color: var(--text-muted); }
.grid-preview { width: 100%; max-height: 160px; border: 1px solid var(--border); border-radius: 4px; }
.buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.danger { color: var(--danger); }
.row-table { font-size: 12px; color: var(--text-secondary); }
.row-table summary { cursor: pointer; color: var(--accent); margin-bottom: 6px; }
.row-line { display: flex; align-items: flex-end; gap: 8px; padding: 4px 0; border-top: 1px solid var(--border); }
.row-line :deep(input[type="number"]) { width: 90px; }
.row-index { width: 92px; font-size: 11px; color: var(--text-muted); }
code { font-size: 11px; color: var(--text-secondary); }
</style>
