import { computed, reactive, ref, toRaw, watch, type ComputedRef } from "vue";
import type { MaskSettings, Placement, ProjectState, Run, RowSpan, ScreenConfig, ShapeSettings, PatternColor, TestPatternSettings, TileSpec } from "../core/types";
import {
  cloneScreen,
  createPopulation,
  createScreen,
  nextPopulationName,
  nextScreenName,
  refit,
  sanitizeProject,
  setRowCount,
  totalColumns,
} from "../core/screen";
import { normalizeRows, sanitizeMask, sanitizePlacement, sanitizeRuns, sanitizeTestPattern, sanitizeTile } from "../core/sanitize";
import { buildWall, mergeMeshes, type WallResult } from "../core/wall";
import { downloadBytes, downloadText, meshToObj, resourceName } from "../core/obj";
import type { ObjImportResult } from "../core/objImport";
import { bytesToBase64, clipToScreen, encodeMaskPng, maskFileName, maskLayout, type MaskLayout } from "../core/mask";
import { loadDesignerState, saveDesignerState, saveObjToDesigner, savePopulationMaskToDesigner, saveTestPatternToDesigner, type PopulationMaskResult } from "./designer";
import { testPatternFileName, testPatternLayout, type TestPatternLayout } from "../core/testPattern";
import { loadImage, renderPatternPart, type PatternLogos } from "../core/testPatternRender";

export interface MaskExport {
  fileName: string;
  layout: MaskLayout;
  designer?: PopulationMaskResult;
}

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

  /* ---------------- OBJ import ---------------- */

  /** Add a screen rebuilt from an imported OBJ and make it active. */
  function addImportedScreen(name: string, result: ObjImportResult, designer?: { resourceName: string; resolution: [number, number] }) {
    const s = createScreen(name.trim() || nextScreenName(state.screens));
    s.tile = sanitizeTile(result.tile);
    s.runs = sanitizeRuns(result.runs);
    s.rows = normalizeRows(result.rows, result.rows.length, totalColumns(s));
    s.shape.kind = "custom";
    s.shape.autoFit = false;
    s.placement = sanitizePlacement(result.placement);
    if (designer) s.designer = { ...designer, updatedAt: new Date().toISOString() };
    state.screens.push(s);
    state.activeId = s.id;
    return s;
  }

  /* ---------------- population variants ---------------- */

  function findPopulation(id: string) {
    return active.value.populations.find((p) => p.id === id);
  }

  function addPopulation() {
    const s = active.value;
    s.populations.push(createPopulation(s, nextPopulationName(s)));
  }

  function duplicatePopulation(id: string) {
    const s = active.value;
    const src = findPopulation(id);
    if (!src) return;
    const copy = createPopulation(s, `${src.name} copy`);
    copy.rows = src.rows.map((r) => ({ ...r }));
    s.populations.push(copy);
  }

  function removePopulation(id: string) {
    const s = active.value;
    s.populations = s.populations.filter((p) => p.id !== id);
  }

  function renamePopulation(id: string, name: string) {
    const p = findPopulation(id);
    if (p && name.trim()) p.name = name.trim();
  }

  /** Reset a variant to the screen's current shape. */
  function resetPopulation(id: string) {
    const p = findPopulation(id);
    if (p) p.rows = active.value.rows.map((r) => ({ ...r }));
  }

  function updatePopulationRow(id: string, index: number, patch: Partial<RowSpan>) {
    const s = active.value;
    const p = findPopulation(id);
    if (!p) return;
    const base = clipToScreen(s.rows, p.rows);
    const rows = base.map((r, i) => (i === index ? { ...r, ...patch } : r));
    p.rows = normalizeRows(rows, s.rows.length, totalColumns(s));
  }

  /** Switch a whole variant row on (screen span) or off (no tiles). */
  function setPopulationRowLit(id: string, index: number, lit: boolean) {
    const s = active.value;
    const row = s.rows[index];
    if (!row) return;
    updatePopulationRow(id, index, lit ? { ...row } : { startColumn: row.startColumn, columnCount: 0 });
  }

  function updateMask(patch: Partial<MaskSettings>) {
    const s = active.value;
    s.mask = sanitizeMask({ ...s.mask, ...patch });
  }

  /** Mask layout of the active screen: its own shape (variantId null) or a variant. */
  function activeMaskLayout(variantId: string | null): MaskLayout {
    const s = active.value;
    const variant = variantId ? findPopulation(variantId) : null;
    if (variantId && !variant) throw new Error("This population variant no longer exists.");
    return maskLayout(totalColumns(s), clipToScreen(s.rows, variant?.rows), s.tile);
  }

  /* ---------------- export ---------------- */

  function activeObj(): { name: string; text: string; width: number; height: number } | null {
    errorText.value = "";
    const wall = activeWall.value;
    if (!wall || wall.tileCount === 0) {
      errorText.value = "Check the active screen's parameters: the mesh has no tiles.";
      return null;
    }
    const name = resourceName(active.value.name);
    return { name, text: meshToObj(wall.mesh, name), width: wall.resolutionX, height: wall.resolutionY };
  }

  /**
   * Standalone: download the OBJ. Plugin: write it into the project's
   * objects/Mesh folder through Python (a browser download would be filed by
   * Designer under objects/meshfromobj).
   */
  async function exportActiveObj(): Promise<{ name: string; width: number; height: number; path?: string } | null> {
    const obj = activeObj();
    if (!obj) return null;
    if (mode !== "plugin") {
      downloadText(obj.text, `${obj.name}.obj`);
      return obj;
    }
    try {
      const path = await saveObjToDesigner(obj.name, obj.text);
      return { ...obj, path };
    } catch (e) {
      errorText.value = `Could not save the OBJ in the Designer project: ${e instanceof Error ? e.message : e}`;
      return null;
    }
  }

  async function exportAllObj(): Promise<string | null> {
    errorText.value = "";
    const meshes = state.screens.map((s) => derived(s).value?.mesh).filter((m) => m && m.indices.length > 0);
    if (meshes.length === 0) {
      errorText.value = "No valid screens to export.";
      return null;
    }
    const merged = mergeMeshes(meshes as NonNullable<(typeof meshes)[number]>[], "displayforge-scene");
    const text = meshToObj(merged, "displayforge-scene");
    if (mode !== "plugin") {
      downloadText(text, "displayforge-scene.obj");
      return "displayforge-scene.obj";
    }
    try {
      return await saveObjToDesigner("displayforge-scene", text);
    } catch (e) {
      errorText.value = `Could not save the OBJ in the Designer project: ${e instanceof Error ? e.message : e}`;
      return null;
    }
  }

  /**
   * Build the population mask PNG of the active screen (own shape or a
   * variant). Standalone: download it. Plugin: write it into objects/DxTexture
   * and, if enabled, set it as the LED screen's population mask.
   */
  async function exportMask(variantId: string | null): Promise<MaskExport> {
    const s = active.value;
    const layout = activeMaskLayout(variantId);
    const variant = variantId ? findPopulation(variantId) : null;
    const fileName = maskFileName(s.name, variant?.name);
    const png = await encodeMaskPng(layout, s.mask.absent);
    if (mode !== "plugin") {
      downloadBytes(png, `${fileName}.png`, "image/png");
      return { fileName, layout };
    }
    const designer = await savePopulationMaskToDesigner(resourceName(s.name), fileName, bytesToBase64(png), s.mask.assignToScreen);
    return { fileName, layout, designer };
  }

  /* ---------------- test patterns ---------------- */

  function activeTestPatternLayout(): TestPatternLayout {
    const s = active.value;
    return testPatternLayout(s.name, totalColumns(s), s.rows, s.tile, s.testPattern);
  }

  function updateTestPattern(patch: Partial<TestPatternSettings>) {
    const s = active.value;
    s.testPattern = sanitizeTestPattern({ ...s.testPattern, ...patch });
  }

  /** Select / deselect one colour; the last selected colour cannot be removed. */
  function setTestPatternColor(name: PatternColor, on: boolean) {
    const current = active.value.testPattern.colors;
    const next = on ? [...current, name] : current.filter((c) => c !== name);
    if (next.length) updateTestPattern({ colors: next });
  }

  let logoCache: Promise<PatternLogos> | undefined;
  /** DisplayForge icon everywhere; the Disguise logo only in the Designer plugin, and only if installed. */
  function patternLogos(): Promise<PatternLogos> {
    logoCache ??= (async () => {
      const displayforge = await loadImage("./icon.png");
      if (mode !== "plugin") return { displayforge };
      const disguise = (await loadImage("./brand/disguise-logo-white.svg")) ?? (await loadImage("./brand/disguise-logo-white.png"));
      return {
        displayforge,
        disguise,
        disguiseSize: disguise ? { width: disguise.naturalWidth, height: disguise.naturalHeight } : undefined,
      };
    })();
    return logoCache;
  }

  /** Render every part of the active screen's test pattern; download it or save it in objects/VideoFile/TestPattern. */
  async function exportTestPattern(onProgress: (message: string) => void): Promise<{ layout: TestPatternLayout; files: string[] }> {
    const layout = activeTestPatternLayout();
    const logos = await patternLogos();
    const files: string[] = [];
    for (const [i, part] of layout.parts.entries()) {
      const fileName = testPatternFileName(layout.screenName, part);
      const tag = layout.parts.length > 1 ? ` (part ${i + 1}/${layout.parts.length})` : "";
      const png = await renderPatternPart(layout, part, logos, (f) => onProgress(`Rendering ${fileName}.png${tag} · ${Math.round(f * 100)} %`));
      if (mode !== "plugin") {
        downloadBytes(png, `${fileName}.png`, "image/png");
        files.push(`${fileName}.png`);
      } else {
        onProgress(`Saving ${fileName}.png in the project…`);
        files.push(await saveTestPatternToDesigner(fileName, bytesToBase64(png)));
      }
    }
    return { layout, files };
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
    addImportedScreen,
    addPopulation,
    duplicatePopulation,
    removePopulation,
    renamePopulation,
    resetPopulation,
    updatePopulationRow,
    setPopulationRowLit,
    updateMask,
    activeMaskLayout,
    exportActiveObj,
    exportAllObj,
    exportMask,
    activeTestPatternLayout,
    updateTestPattern,
    setTestPatternColor,
    patternLogos,
    exportTestPattern,
  };
}

export type Store = ReturnType<typeof createStore>;
