<script setup lang="ts">
import type { Run } from "../core/types";
import NumField from "./NumField.vue";

const props = defineProps<{ runs: Run[] }>();
const emit = defineEmits<{ "update:runs": [runs: Run[]] }>();

function patch(index: number, change: Partial<Run>) {
  emit("update:runs", props.runs.map((r, i) => (i === index ? { ...r, ...change } : r)));
}
function add() {
  emit("update:runs", [...props.runs, { columns: 4, angleBetweenTilesDeg: 0 }]);
}
function remove(index: number) {
  if (props.runs.length > 1) emit("update:runs", props.runs.filter((_, i) => i !== index));
}
function move(index: number, delta: number) {
  const j = index + delta;
  if (j < 0 || j >= props.runs.length) return;
  const next = [...props.runs];
  [next[index], next[j]] = [next[j], next[index]];
  emit("update:runs", next);
}
</script>

<template>
  <div class="run-editor">
    <div v-for="(run, i) in runs" :key="i" class="run-row">
      <span class="run-index">{{ i + 1 }}</span>
      <NumField label="Columns" :model-value="run.columns" :min="1" integer @update:model-value="patch(i, { columns: $event })" />
      <NumField
        label="Hinge angle / joint (°)"
        :model-value="run.angleBetweenTilesDeg"
        :min="-180"
        :max="180"
        step="0.1"
        @update:model-value="patch(i, { angleBetweenTilesDeg: $event })"
      />
      <div class="run-actions">
        <button type="button" title="Move up" :disabled="i === 0" @click="move(i, -1)">↑</button>
        <button type="button" title="Move down" :disabled="i === runs.length - 1" @click="move(i, 1)">↓</button>
        <button type="button" title="Remove run" :disabled="runs.length <= 1" @click="remove(i)">✕</button>
      </div>
    </div>
    <button type="button" class="dashed" @click="add">+ Add run</button>
    <p class="hint">
      The hinge angle is applied at the joint before every column of the run (including the joint with the previous run).
      Positive angles bend the wall towards the audience.
    </p>
  </div>
</template>

<style scoped>
.run-editor { display: flex; flex-direction: column; gap: 6px; }
.run-row { display: flex; align-items: flex-end; gap: 8px; background: var(--panel-alt); border: 1px solid var(--border); border-radius: 4px; padding: 8px; }
.run-index { width: 18px; color: var(--text-muted); font-size: 12px; padding-bottom: 6px; }
.run-row :deep(input) { width: 90px; }
.run-actions { display: flex; gap: 4px; margin-left: auto; }
.run-actions button { width: 26px; height: 26px; background: var(--panel); border: 1px solid var(--border); color: var(--text-primary); border-radius: 3px; cursor: pointer; }
.run-actions button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.run-actions button:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
