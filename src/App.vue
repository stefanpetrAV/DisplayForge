<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import type { AppMode, Store } from "./state/store";
import { createLedScreen } from "./state/designer";
import { sanitizePlacement } from "./core/sanitize";
import { totalColumns } from "./core/screen";
import { resourceName } from "./core/obj";
import NumField from "./components/NumField.vue";
import RunEditor from "./components/RunEditor.vue";
import ShapeEditor from "./components/ShapeEditor.vue";
import TransformEditor from "./components/TransformEditor.vue";
import ScreenManager from "./components/ScreenManager.vue";
import PlanView from "./components/PlanView.vue";

// three.js is only loaded when a 3D view is shown (keeps the plugin light).
const MeshViewer3D = defineAsyncComponent(() => import("./components/MeshViewer3D.vue"));
const iconUrl = "./icon.svg";

const props = defineProps<{ mode: AppMode; store: Store }>();
const store = props.store;
const isPlugin = props.mode === "plugin";

const screen = computed(() => store.active.value);
const wall = computed(() => store.activeWall.value);
const columns = computed(() => totalColumns(screen.value));

const screenItems = computed(() =>
  store.state.screens.map((s) => ({
    id: s.id,
    name: s.name,
    isActive: s.id === screen.value.id,
    tileCount: store.derived(s).value?.tileCount ?? 0,
    inDesigner: !!s.designer,
  })),
);
const planWalls = computed(() =>
  store.scene.value.filter((e) => e.wall).map((e) => ({ id: e.id, isActive: e.isActive, points: e.wall!.planPoints })),
);
const viewerEntries = computed(() => store.scene.value.map((e) => ({ id: e.id, isActive: e.isActive, mesh: e.wall?.mesh ?? null })));
const exportName = computed(() => resourceName(screen.value.name));

/* ---------- Designer: create LED screen ---------- */
const creating = ref(false);
const createStatus = ref("");
const createError = ref(false);

async function onCreateLedScreen() {
  creating.value = true;
  createError.value = false;
  createStatus.value = "Exporting OBJ…";
  const target = screen.value;
  try {
    const exported = store.downloadActiveObj();
    if (!exported) throw new Error(store.errorText.value || "Could not export the mesh.");
    const res = await createLedScreen(exported.name, exported.width, exported.height, (m) => (createStatus.value = m));
    target.designer = { resourceName: exported.name, resolution: res.resolution, updatedAt: new Date().toISOString() };
    createStatus.value = `${res.name} created / updated in Designer · ${res.resolution[0]} × ${res.resolution[1]} px`;
  } catch (e) {
    createError.value = true;
    createStatus.value = e instanceof Error ? e.message : String(e);
    console.error("[DisplayForge] LED screen creation failed", e);
  } finally {
    creating.value = false;
  }
}

/* ---------- sidebar splitter (standalone) ---------- */
const SIDEBAR_KEY = "displayforge.sidebarWidth";
const sidebarWidth = ref(readWidth());
function readWidth() {
  try {
    const n = Number(localStorage.getItem(SIDEBAR_KEY));
    return Number.isFinite(n) && n >= 320 && n <= 760 ? n : 420;
  } catch {
    return 420;
  }
}
function startDrag(e: PointerEvent) {
  const startX = e.clientX;
  const startW = sidebarWidth.value;
  const move = (ev: PointerEvent) => (sidebarWidth.value = Math.min(760, Math.max(320, startW + ev.clientX - startX)));
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.style.removeProperty("user-select");
    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth.value));
    } catch {
      /* ignore */
    }
  };
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

const show3dInPlugin = ref(false);

onMounted(() => store.init());

const syncClass = computed(() => ({
  ok: store.syncStatus.value === "designer",
  warn: store.syncStatus.value === "local" && isPlugin,
  err: store.syncStatus.value === "designer-error",
}));
</script>

<template>
  <div class="app" :class="isPlugin ? 'app-plugin' : 'app-standalone'">
    <header>
      <div class="brand">
        <img :src="iconUrl" alt="" class="brand-icon" />
        <h1>DisplayForge</h1>
      </div>
      <div class="header-actions">
        <button type="button" class="ghost" @click="store.downloadAllObj()">Download all (.obj)</button>
        <button type="button" class="primary" @click="store.downloadActiveObj()">Download active (.obj)</button>
      </div>
    </header>

    <div class="layout" :style="isPlugin ? undefined : { gridTemplateColumns: `${sidebarWidth}px 6px 1fr` }">
      <aside class="sidebar">
        <section class="panel">
          <h2>Screens</h2>
          <ScreenManager
            :screens="screenItems"
            @select="store.selectScreen"
            @rename="store.renameScreen"
            @duplicate="store.duplicateScreen"
            @remove="store.removeScreen"
            @add="store.addScreen"
          />
          <p v-if="isPlugin || store.syncMessage.value" class="sync" :class="syncClass">{{ store.syncMessage.value || "Loading screens…" }}</p>
          <p v-if="store.errorText.value" class="error">{{ store.errorText.value }}</p>
        </section>

        <section class="panel">
          <h2>Tile — {{ screen.name }}</h2>
          <div class="grid-2">
            <NumField label="Tile width (mm)" :model-value="screen.tile.tileWidthMm" :min="1" @update:model-value="store.updateTile({ tileWidthMm: $event })" />
            <NumField label="Tile height (mm)" :model-value="screen.tile.tileHeightMm" :min="1" @update:model-value="store.updateTile({ tileHeightMm: $event })" />
            <NumField label="Tile resolution X (px)" :model-value="screen.tile.tileResolutionX" :min="1" integer @update:model-value="store.updateTile({ tileResolutionX: $event })" />
            <NumField label="Tile resolution Y (px)" :model-value="screen.tile.tileResolutionY" :min="1" integer @update:model-value="store.updateTile({ tileResolutionY: $event })" />
          </div>
        </section>

        <section class="panel">
          <h2>Runs (straight → curved → straight…)</h2>
          <RunEditor :runs="screen.runs" @update:runs="store.updateRuns" />
        </section>

        <section class="panel">
          <h2>Shape (rows / columns)</h2>
          <ShapeEditor
            :rows="screen.rows"
            :shape="screen.shape"
            :total-columns="columns"
            @shape="store.updateShape"
            @row-count="store.updateRowCount"
            @row="store.updateRow"
          />
        </section>

        <section class="panel">
          <h2>Origin and placement</h2>
          <TransformEditor
            :placement="screen.placement"
            :auto-orientation-deg="wall?.autoOrientationDeg ?? null"
            @update="store.updatePlacement"
            @reset="store.updatePlacement(sanitizePlacement(undefined))"
          />
        </section>

        <section v-if="isPlugin" class="panel">
          <h2>Plan view (top-down)</h2>
          <PlanView :walls="planWalls" />
          <div v-if="wall" class="stats">
            <span>{{ columns }} columns × {{ screen.rows.length }} rows ({{ wall.tileCount }} tiles)</span>
            <span>{{ wall.resolutionX }} × {{ wall.resolutionY }} px</span>
            <span>{{ (wall.physicalWidthMm / 1000).toFixed(2) }} × {{ (wall.physicalHeightMm / 1000).toFixed(2) }} m (unrolled)</span>
          </div>
          <details class="viewer-toggle" @toggle="show3dInPlugin = ($event.target as HTMLDetailsElement).open">
            <summary>3D preview</summary>
            <div v-if="show3dInPlugin" class="plugin-viewer"><MeshViewer3D :entries="viewerEntries" /></div>
          </details>
        </section>

        <section class="panel actions">
          <h2>Export</h2>
          <label class="field">
            <span>Screen name</span>
            <input type="text" :value="screen.name" @change="store.renameScreen(screen.id, ($event.target as HTMLInputElement).value)" />
          </label>
          <p class="hint">
            File / resource name: <code>{{ exportName }}.obj</code>
            <template v-if="screen.designer"> · last sent to Designer {{ new Date(screen.designer.updatedAt).toLocaleString() }}</template>
          </p>
          <button type="button" class="primary" @click="store.downloadActiveObj()">Download .obj</button>
          <template v-if="isPlugin">
            <button type="button" class="primary" :disabled="creating" @click="onCreateLedScreen">
              {{ screen.designer ? "Update LED Screen in Designer" : "Create LED Screen in Designer" }}
            </button>
            <p v-if="createStatus" class="status" :class="{ error: createError }">{{ createStatus }}</p>
          </template>
        </section>
      </aside>

      <template v-if="!isPlugin">
        <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" @pointerdown="startDrag" />
        <section class="stage">
          <div class="panel viewer-panel">
            <h2>3D preview</h2>
            <div class="viewer-box"><MeshViewer3D :entries="viewerEntries" /></div>
            <p class="hint">Drag to orbit, scroll to zoom, right-click drag to pan. Active screen in orange; back faces are dark grey.</p>
          </div>
          <div class="panel">
            <h2>Plan view (top-down) — all screens</h2>
            <PlanView :walls="planWalls" />
            <div v-if="wall" class="stats">
              <span>{{ columns }} columns × {{ screen.rows.length }} rows ({{ wall.tileCount }} tiles)</span>
              <span>{{ wall.resolutionX }} × {{ wall.resolutionY }} px</span>
              <span>{{ (wall.physicalWidthMm / 1000).toFixed(2) }} × {{ (wall.physicalHeightMm / 1000).toFixed(2) }} m (unrolled)</span>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.app-standalone { height: 100vh; display: flex; flex-direction: column; }
.app-plugin { min-height: 100vh; }
header { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.header-actions { display: flex; gap: 8px; }
.layout { flex: 1; display: grid; overflow: hidden; }
.app-plugin .layout { display: block; overflow: visible; }
.sidebar { overflow-y: auto; overflow-x: hidden; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.splitter { background: var(--border); cursor: col-resize; }
.splitter:hover { background: var(--accent); }
.stage { overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.viewer-panel { display: flex; flex-direction: column; flex: 1; min-height: 360px; }
.viewer-box { flex: 1; min-height: 300px; }
.plugin-viewer { height: 320px; margin-top: 8px; }
.viewer-toggle summary { cursor: pointer; color: var(--accent); font-size: 12px; margin-top: 8px; }
.actions { display: flex; flex-direction: column; gap: 8px; }
.sync { font-size: 11px; color: var(--text-muted); margin-top: 8px; }
.sync.ok { color: #77dd99; }
.sync.warn { color: #e0b050; }
.sync.err { color: var(--danger); }
.status { font-size: 12px; color: #77dd99; white-space: normal; }
.status.error { color: var(--danger); }
code { font-size: 11px; color: var(--text-secondary); }
@media (max-width: 760px) {
  .app-standalone { height: auto; }
  .app-standalone .layout { display: block; overflow: visible; }
  .app-standalone .splitter { display: none; }
}
</style>
