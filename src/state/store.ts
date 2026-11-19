import { computed, reactive, ref, toRaw, watch, type ComputedRef } from "vue";
import type { Placement, ProjectState, Run, RowSpan, ScreenConfig, ShapeSettings, TileSpec } from "../core/types";
import { cloneScreen, createScreen, nextScreenName, refit, sanitizeProject, setRowCount, totalColumns } from "../core/screen";
import { normalizeRows, sanitizePlacement, sanitizeRuns, sanitizeTile } from "../core/sanitize";
import { buildWall, mergeMeshes, type WallResult } from "../core/wall";
import { downloadText, meshToObj, resourceName } from "../core/obj";
import { loadDesignerState, saveDesignerState } from "./designer";

export type AppMode = "plugin" | "standalone";
export type SyncStatus = "local" | "loading" | "designer" | "designer-error";

const LOCAL_KEY = "displayforge.project.v1";

function readLocal(key: string): ProjectState | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? sanitizeProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, json: string): void {
  try {
    localStorage.setItem(key, json);
  } catch {
    /* storage unavailable (private mode, quota): ignore */
  }
}

function freshProject(): ProjectState {
  const screen = createScreen("Screen 1");
  return { version: 1, activeId: screen.id, screens: [screen] };
}

export function createStore(mode: AppMode) {
  const state = reactive<ProjectState>(mode === "standalone" ? readLocal(LOCAL_KEY) ?? freshProject() : freshProject());
  const syncStatus = ref<SyncStatus>(mode === "plugin" ? "loading" : "local");
  const syncMessage = ref("");
  const errorText = ref("");
  /** In plugin mode, nothing is saved until the initial load from Designer is done. */
  let ready = mode === "standalone";
  let localKey = LOCAL_KEY;

  /* ---------------- derived geometry (memoised per screen) ---------------- */

  const cache = new WeakMap<object, ComputedRef<WallResult | null>>();
  function derived(screen: ScreenConfig): ComputedRef<WallResult | null> {
    const key = toRaw(screen);
    let c = cache.get(key);
    if (!c) {
      c = computed(() => {
        try {
          return buildWall({ name: screen.name, tile: screen.tile, runs: screen.runs, rows: screen.rows, placement: screen.placement });
        } catch (e) {
          console.error("[DisplayForge] mesh build failed", e);
          return null;
        }
      });
      cache.set(key, c);
    }
    return c;
  }

  const active = computed(() => state.screens.find((s) => s.id === state.activeId) ?? state.screens[0]);
  const activeWall = computed(() => derived(active.value).value);
  const scene = computed(() =>
    state.screens.map((s) => ({ id: s.id, name: s.name, isActive: s.id === active.value.id, wall: derived(s).value })),
  );

  /* ---------------- persistence ---------------- */

  let saveTimer: number | undefined;
  function scheduleSave() {
    if (!ready) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, 500);
  }

  async function saveNow() {
    const json = JSON.stringify(state);
    writeLocal(localKey, json);
    if (mode !== "plugin" || syncStatus.value === "local") return;
    try {
      const res = await saveDesignerState(json);
      if (!res?.ok) throw new Error(res?.error || "Designer did not confirm the save.");
      syncStatus.value = "designer";
      syncMessage.value = `Saved in the Designer project (${res.stateFile ?? "displayforge/screens.json"})`;
    } catch (e) {
      syncStatus.value = "designer-error";
      syncMessage.value = `Could not save in the Designer project: ${e instanceof Error ? e.message : e}. A local copy is kept in this browser.`;
    }
  }

  function replaceState(next: ProjectState) {
    state.screens = next.screens;
    state.activeId = next.activeId;
  }

  async function init() {
    if (mode !== "plugin") return;
    try {
      const res = await loadDesignerState();
      if (!res?.ok) throw new Error(res?.error || "Designer did not return the project state.");
      localKey = `${LOCAL_KEY}:${res.projectFolder ?? "unknown"}`;
      const fromDesigner = sanitizeProject(res.data);
      const fromLocal = readLocal(localKey);
      const chosen = fromDesigner ?? fromLocal;
      if (chosen) replaceState(chosen);
      syncStatus.value = "designer";
      syncMessage.value = fromDesigner
        ? `Loaded ${fromDesigner.screens.length} screen(s) from the Designer project`
        : "No saved screens in this Designer project yet";
      ready = true;
      if (!fromDesigner && fromLocal) void saveNow();
    } catch (e) {
      // Not running inside Designer (or the API is unreachable): fall back to browser storage.
      const fromLocal = readLocal(LOCAL_KEY);
      if (fromLocal) replaceState(fromLocal);
      syncStatus.value = "local";
      syncMessage.value = `Designer project storage unavailable (${e instanceof Error ? e.message : e}); screens are kept in this browser only.`;
      ready = true;
    }
  }

  watch(state, scheduleSave, { deep: true });
  window.addEventListener("beforeunload", () => {
    if (ready) writeLocal(localKey, JSON.stringify(state));
  });

  /* ---------------- screen list ---------------- */

  function addScreen() {
    const s = createScreen(nextScreenName(state.screens));
    state.screens.push(s);
    state.activeId = s.id;
  }

  function duplicateScreen(id: string) {
    const src = state.screens.find((s) => s.id === id);
    if (!src) return;
    const copy = cloneScreen(toRaw(src), nextScreenName(state.screens));
    copy.placement.positionM.x += 1;
    state.screens.push(copy);
    state.activeId = copy.id;
  }

  function removeScreen(id: string) {
    if (state.screens.length <= 1) return;
    const i = state.screens.findIndex((s) => s.id === id);
    if (i < 0) return;
    state.screens.splice(i, 1);
    if (state.activeId === id) state.activeId = state.screens[Math.max(0, i - 1)].id;
  }

  function selectScreen(id: string) {
    state.activeId = id;
  }

  function renameScreen(id: string, name: string) {
    const s = state.screens.find((x) => x.id === id);
    if (s && name.trim()) s.name = name.trim();
  }

  /* ---------------- edits on the active screen ---------------- */

  function updateTile(patch: Partial<TileSpec>) {
    const s = active.value;
    s.tile = sanitizeTile({ ...s.tile, ...patch });
    refit(s);
  }

  function updateRuns(runs: Run[]) {
    const s = active.value;
    s.runs = sanitizeRuns(runs);
    refit(s);
  }

  function updateRowCount(n: number) {
    setRowCount(active.value, n);
  }

  function updateShape(patch: Partial<ShapeSettings>) {
    const s = active.value;
    const sizeEdited = ["triangleBaseColumns", "circleDiameterColumns", "diamondWidthColumns"].some((k) => k in patch);
    Object.assign(s.shape, patch);
    if (sizeEdited) s.shape.autoFit = false;
    refit(s);
  }

  function updateRow(index: number, patch: Partial<RowSpan>) {
    const s = active.value;
    const rows = s.rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    s.rows = normalizeRows(rows, s.rows.length, totalColumns(s));
    s.shape.kind = "custom";
  }

  function updatePlacement(p: Placement) {
    active.value.placement = sanitizePlacement(p);
  }

  /* ---------------- export ---------------- */

  function downloadActiveObj(): { name: string; width: number; height: number } | null {
    errorText.value = "";
    const wall = activeWall.value;
    if (!wall || wall.tileCount === 0) {
      errorText.value = "Check the active screen's parameters: the mesh has no tiles.";
      return null;
    }
    const name = resourceName(active.value.name);
    downloadText(meshToObj(wall.mesh, name), `${name}.obj`);
    return { name, width: wall.resolutionX, height: wall.resolutionY };
  }

  function downloadAllObj() {
    errorText.value = "";
    const meshes = state.screens.map((s) => derived(s).value?.mesh).filter((m) => m && m.indices.length > 0);
    if (meshes.length === 0) {
      errorText.value = "No valid screens to export.";
      return;
    }
    const merged = mergeMeshes(meshes as NonNullable<(typeof meshes)[number]>[], "displayforge-scene");
    downloadText(meshToObj(merged, "displayforge-scene"), "displayforge-scene.obj");
  }

  return {
    state,
    active,
    activeWall,
    scene,
    derived,
    syncStatus,
    syncMessage,
    errorText,
    init,
    addScreen,
    duplicateScreen,
    removeScreen,
    selectScreen,
    renameScreen,
    updateTile,
    updateRuns,
    updateRowCount,
    updateShape,
    updateRow,
    updatePlacement,
    downloadActiveObj,
    downloadAllObj,
  };
}

export type Store = ReturnType<typeof createStore>;
