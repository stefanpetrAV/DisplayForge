<script setup lang="ts">
import { computed, ref } from "vue";
import type { TileSpec } from "../core/types";
import { importObj, nameFromPath, type ObjImportResult } from "../core/objImport";
import { listProjectMeshes, readProjectMesh, type ProjectMesh, type ProjectMeshScreen } from "../state/designer";
import NumField from "./NumField.vue";

const props = defineProps<{ isPlugin: boolean; defaultTile: TileSpec }>();
const emit = defineEmits<{
  imported: [name: string, result: ObjImportResult, designer?: { resourceName: string; resolution: [number, number] }];
}>();

const tileResX = ref(props.defaultTile.tileResolutionX);
const tileResY = ref(props.defaultTile.tileResolutionY);

const meshes = ref<ProjectMesh[] | null>(null);
const selected = ref("");
const busy = ref(false);
const status = ref("");
const isError = ref(false);
const report = ref<{ name: string; source: string; result: ObjImportResult; resolutionFrom?: string } | null>(null);

const selectedMesh = computed(() => meshes.value?.find((m) => m.path === selected.value) ?? null);

function describe(m: ProjectMesh) {
  const used = m.screens.map((s) => `${s.name} ${s.resolution[0]}×${s.resolution[1]}`).join(", ");
  return `${m.path}${used ? ` — LED screen ${used}` : ""}`;
}

async function loadList() {
  busy.value = true;
  status.value = "";
  isError.value = false;
  try {
    meshes.value = await listProjectMeshes();
    if (!meshes.value.some((m) => m.path === selected.value)) selected.value = meshes.value[0]?.path ?? "";
    if (meshes.value.length === 0) status.value = "No OBJ files in objects/Mesh.";
  } catch (e) {
    isError.value = true;
    status.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

/**
 * Run the analysis. When exactly one LED screen of the project uses the mesh,
 * the tile resolution comes from that screen (screen resolution ÷ grid) and the
 * imported screen takes its name, so "Update LED Screen" targets it.
 */
function analyse(text: string, source: string, screens: ProjectMeshScreen[]) {
  // First pass only to read the grid size.
  let result = importObj(text, { tileResolutionX: tileResX.value, tileResolutionY: tileResY.value });
  let name = nameFromPath(source);
  let resolutionFrom: string | undefined;
  let designer: { resourceName: string; resolution: [number, number] } | undefined;
  const screen = screens.length === 1 ? screens[0] : null;
  if (screen) {
    const [w, h] = screen.resolution;
    if (w % result.columns === 0 && h % result.rowCount === 0) {
      tileResX.value = w / result.columns;
      tileResY.value = h / result.rowCount;
      result = importObj(text, { tileResolutionX: tileResX.value, tileResolutionY: tileResY.value });
      resolutionFrom = `LED screen ${screen.name} (${w} × ${h} px)`;
    } else {
      result.warnings.push(
        `LED screen ${screen.name} is ${w} × ${h} px, which is not a whole number of pixels per tile for ${result.columns} × ${result.rowCount} tiles: the tile resolution entered here was used.`,
      );
    }
    name = screen.name;
    designer = { resourceName: screen.name, resolution: screen.resolution };
  } else if (screens.length > 1) {
    result.warnings.push(`${screens.length} LED screens use this mesh: the tile resolution entered here was used.`);
  }
  emit("imported", name, result, designer);
  report.value = { name, source, result, resolutionFrom };
  status.value = "";
}

async function importSelected() {
  if (!selectedMesh.value) return;
  busy.value = true;
  isError.value = false;
  status.value = `Reading ${selectedMesh.value.path}…`;
  try {
    const mesh = await readProjectMesh(selectedMesh.value.path);
    analyse(mesh.text, mesh.path, mesh.screens);
  } catch (e) {
    isError.value = true;
    status.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function importFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = true;
  isError.value = false;
  status.value = `Reading ${file.name}…`;
  try {
    analyse(await file.text(), file.name, []);
  } catch (err) {
    isError.value = true;
    status.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

const runSummary = computed(() => {
  const r = report.value?.result;
  if (!r) return "";
  return r.runs.map((run) => `${run.columns} × ${run.angleBetweenTilesDeg}°`).join(" · ");
});
</script>

<template>
  <div class="obj-import">
    <p class="hint">
      Rebuild a screen from an OBJ: grid and shape come from the UV map, tile size and curves from the mesh, placement from a
      best fit. The OBJ needs a regular UV grid with a vertex on every tile corner (e.g. one quad per tile).
    </p>
    <div class="grid-2">
      <NumField label="Tile resolution X (px)" :model-value="tileResX" :min="1" integer @update:model-value="tileResX = $event" />
      <NumField label="Tile resolution Y (px)" :model-value="tileResY" :min="1" integer @update:model-value="tileResY = $event" />
    </div>
    <p v-if="isPlugin" class="hint">In the plugin the tile resolution is read from the LED screen that uses the mesh, when there is one.</p>

    <template v-if="isPlugin">
      <div class="row">
        <button type="button" class="ghost" :disabled="busy" @click="loadList">{{ meshes ? "Refresh list" : "List project OBJ files" }}</button>
      </div>
      <template v-if="meshes && meshes.length">
        <label class="field">
          <span>OBJ in the project</span>
          <select v-model="selected">
            <option v-for="m in meshes" :key="m.path" :value="m.path">{{ describe(m) }}</option>
          </select>
        </label>
        <button type="button" class="primary" :disabled="busy || !selectedMesh" @click="importSelected">Import selected OBJ</button>
      </template>
    </template>

    <label class="file-button" :class="{ disabled: busy }">
      <input type="file" accept=".obj" :disabled="busy" @change="importFile" />
      {{ isPlugin ? "Import a local OBJ file…" : "Import OBJ file…" }}
    </label>

    <p v-if="status" class="status" :class="{ error: isError }">{{ status }}</p>

    <div v-if="report" class="report">
      <p>
        <strong>{{ report.name }}</strong> imported from <code>{{ report.source }}</code> as a new screen.
      </p>
      <ul>
        <li>{{ report.result.columns }} columns × {{ report.result.rowCount }} rows, {{ report.result.tileCount }} tiles</li>
        <li>
          Tile {{ report.result.tile.tileWidthMm }} × {{ report.result.tile.tileHeightMm }} mm,
          {{ report.result.tile.tileResolutionX }} × {{ report.result.tile.tileResolutionY }} px<template v-if="report.resolutionFrom"> (from {{ report.resolutionFrom }})</template>
        </li>
        <li>Runs: {{ runSummary }}</li>
        <li>Largest difference from the OBJ: {{ report.result.maxErrorMm }} mm</li>
      </ul>
      <p v-for="(w, i) in report.result.warnings" :key="i" class="warn">{{ w }}</p>
    </div>
  </div>
</template>

<style scoped>
.obj-import { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; gap: 8px; }
.field select { width: 100%; }
.file-button { display: inline-flex; align-self: flex-start; align-items: center; padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px; cursor: pointer; color: var(--accent); }
.file-button:hover { border-color: var(--accent); }
.file-button.disabled { opacity: 0.5; pointer-events: none; }
.file-button input { display: none; }
.status { font-size: 12px; color: #77dd99; white-space: normal; }
.status.error { color: var(--danger); }
.report { font-size: 12px; color: var(--text-secondary); border-top: 1px solid var(--border); padding-top: 8px; }
.report ul { margin: 4px 0 0 16px; padding: 0; }
.warn { font-size: 11px; color: #e0b050; }
code { font-size: 11px; color: var(--text-secondary); }
</style>
