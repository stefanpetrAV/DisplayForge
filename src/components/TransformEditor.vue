<script setup lang="ts">
import type { Placement, Vec3Like } from "../core/types";
import NumField from "./NumField.vue";

const props = defineProps<{ placement: Placement; autoOrientationDeg: number | null }>();
const emit = defineEmits<{ update: [placement: Placement]; reset: [] }>();

function set<K extends keyof Placement>(key: K, value: Placement[K]) {
  emit("update", { ...props.placement, [key]: value });
}
function setVec(key: "positionM" | "rotationDeg", axis: keyof Vec3Like, value: number) {
  set(key, { ...props.placement[key], [axis]: value });
}
</script>

<template>
  <div class="transform-editor">
    <div class="row">
      <label class="field">
        <span>Origin X</span>
        <select :value="placement.originX" @change="set('originX', ($event.target as HTMLSelectElement).value as Placement['originX'])">
          <option value="left">Left end</option>
          <option value="center">Center</option>
          <option value="right">Right end</option>
        </select>
      </label>
      <label class="field">
        <span>Origin Y</span>
        <select :value="placement.originY" @change="set('originY', ($event.target as HTMLSelectElement).value as Placement['originY'])">
          <option value="bottom">Bottom</option>
          <option value="middle">Middle</option>
          <option value="top">Top</option>
        </select>
      </label>
      <button type="button" class="ghost" @click="emit('reset')">Reset</button>
    </div>
    <div class="group">
      <span class="group-label">Position (m)</span>
      <div class="row">
        <NumField label="X" :model-value="placement.positionM.x" step="0.05" @update:model-value="setVec('positionM', 'x', $event)" />
        <NumField label="Y" :model-value="placement.positionM.y" step="0.05" @update:model-value="setVec('positionM', 'y', $event)" />
        <NumField label="Z" :model-value="placement.positionM.z" step="0.05" @update:model-value="setVec('positionM', 'z', $event)" />
      </div>
    </div>
    <div class="group">
      <span class="group-label">Rotation (°)</span>
      <p v-if="autoOrientationDeg !== null" class="hint">
        Auto-orientation {{ autoOrientationDeg.toFixed(1) }}° is applied first so the middle of the wall faces +Z (the audience);
        the values below are added on top of it.
      </p>
      <div class="row">
        <NumField label="X (tilt)" :model-value="placement.rotationDeg.x" step="1" @update:model-value="setVec('rotationDeg', 'x', $event)" />
        <NumField label="Y (heading)" :model-value="placement.rotationDeg.y" step="1" @update:model-value="setVec('rotationDeg', 'y', $event)" />
        <NumField label="Z (roll)" :model-value="placement.rotationDeg.z" step="1" @update:model-value="setVec('rotationDeg', 'z', $event)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.transform-editor { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; }
.row :deep(input), .row select { width: 90px; }
.group { display: flex; flex-direction: column; gap: 4px; }
.group-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
</style>
