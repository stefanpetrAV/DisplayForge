<script setup lang="ts">
import { nextTick, ref } from "vue";

export interface ScreenListItem {
  id: string;
  name: string;
  isActive: boolean;
  tileCount: number;
  inDesigner: boolean;
}

defineProps<{ screens: ScreenListItem[] }>();
const emit = defineEmits<{
  select: [id: string];
  rename: [id: string, name: string];
  duplicate: [id: string];
  remove: [id: string];
  add: [];
}>();

const editingId = ref<string | null>(null);
const draft = ref("");
const input = ref<HTMLInputElement[]>([]);

async function startRename(item: ScreenListItem) {
  editingId.value = item.id;
  draft.value = item.name;
  await nextTick();
  input.value[0]?.focus();
  input.value[0]?.select();
}
function commit(id: string) {
  if (editingId.value !== id) return;
  if (draft.value.trim()) emit("rename", id, draft.value);
  editingId.value = null;
}
function confirmRemove(item: ScreenListItem) {
  if (window.confirm(`Delete "${item.name}" from DisplayForge? (The LED screen in Designer, if any, is not deleted.)`)) emit("remove", item.id);
}
</script>

<template>
  <div class="screen-manager">
    <div v-for="item in screens" :key="item.id" class="screen-row" :class="{ active: item.isActive }">
      <button type="button" class="select" @click="emit('select', item.id)">
        <span class="dot" :class="{ active: item.isActive }" />
        <input
          v-if="editingId === item.id"
          ref="input"
          v-model="draft"
          class="rename-input"
          type="text"
          @click.stop
          @keyup.enter="commit(item.id)"
          @keyup.esc="editingId = null"
          @blur="commit(item.id)"
        />
        <span v-else class="name">{{ item.name }}</span>
        <span v-if="item.inDesigner" class="badge" title="An LED screen was created in Designer from this screen">d3</span>
        <span class="tile-count" title="Tiles">{{ item.tileCount }}</span>
      </button>
      <div class="row-actions">
        <button type="button" title="Rename" @click="startRename(item)">Rename</button>
        <button type="button" title="Duplicate" @click="emit('duplicate', item.id)">Dup</button>
        <button type="button" title="Delete" :disabled="screens.length <= 1" @click="confirmRemove(item)">Del</button>
      </div>
    </div>
    <button type="button" class="dashed" @click="emit('add')">+ Add screen</button>
  </div>
</template>

<style scoped>
.screen-manager { display: flex; flex-direction: column; gap: 6px; }
.screen-row { display: flex; align-items: center; gap: 6px; background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px; padding: 4px; }
.screen-row.active { border-color: var(--accent); }
.select { flex: 1; display: flex; align-items: center; gap: 8px; background: none; border: none; padding: 6px; cursor: pointer; min-width: 0; text-align: left; color: inherit; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); flex-shrink: 0; }
.dot.active { background: var(--accent); }
.name { flex: 1; font-size: 13px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rename-input { flex: 1; background: var(--panel-alt); border: 1px solid var(--accent); color: var(--text-primary); border-radius: 3px; padding: 3px 6px; font-size: 13px; min-width: 0; }
.badge { font-size: 9px; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 0 4px; }
.tile-count { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }
.row-actions { display: flex; gap: 2px; flex-shrink: 0; }
.row-actions button { background: none; border: none; color: var(--text-secondary); border-radius: 3px; cursor: pointer; font-size: 10px; padding: 3px 5px; }
.row-actions button:hover:not(:disabled) { background: var(--panel-alt); color: var(--accent); }
.row-actions button:disabled { opacity: 0.3; cursor: not-allowed; }
</style>
