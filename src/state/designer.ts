/**
 * Bridge to disguise Designer's Python API (only available when the page is
 * served by Designer as a plugin).
 */

const MODULE_NAME = "displayforge_led_screen";
let registration: Promise<unknown> | undefined;

function directorEndpoint(): string {
  const params = new URLSearchParams(window.location.search);
  const director = params.get("director");
  if (director) return director.includes(":") ? director : `${director}:${params.get("port") || "80"}`;
  const host = window.location.host || "localhost";
  return host.includes(":") ? host : `${host}:80`;
}

const apiBase = () => `http://${directorEndpoint()}/api/session/python`;

async function post(path: string, body: unknown): Promise<{ returnValue?: unknown }> {
  const response = await fetch(`${apiBase()}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Designer Python API: HTTP ${response.status} ${response.statusText}`);
  const result = await response.json();
  if (result.status && result.status.code !== 0) {
    throw new Error(result.status.message || "Designer rejected the Python request.");
  }
  return result;
}

function ensureRegistered(): Promise<unknown> {
  if (!registration) {
    registration = fetch("./python/displayforge.py")
      .then((r) => {
        if (!r.ok) throw new Error(`Unable to load the Designer module (HTTP ${r.status}).`);
        return r.text();
      })
      .then((contents) => post("registermodule", { moduleName: MODULE_NAME, contents }))
      .catch((error) => {
        registration = undefined;
        throw error;
      });
  }
  return registration;
}

function parseReturn(raw: unknown): any {
  if (raw === null || raw === undefined || raw === "None") return null;
  let value = raw;
  if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      /* keep raw */
    }
  }
  return typeof value === "string" ? JSON.parse(value) : value;
}

/** Python string literal for an arbitrary JS string (JSON escapes are valid Python 3 escapes). */
const pyStr = (s: string) => JSON.stringify(s);

export async function callPython<T = any>(script: string): Promise<T> {
  await ensureRegistered();
  const result = await post("execute", { moduleName: MODULE_NAME, script });
  return parseReturn(result.returnValue) as T;
}

export interface LoadStateResult {
  ok: boolean;
  projectFolder?: string;
  data?: unknown;
  /** The state was read from the 0.8.x location and should be saved again. */
  migrate?: boolean;
  error?: string;
}

export const loadDesignerState = () => callPython<LoadStateResult>("return load_state()");

export const saveDesignerState = (json: string) =>
  callPython<{ ok: boolean; error?: string; stateFile?: string }>(`return save_state(${pyStr(json)})`);

const delay = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/**
 * Write an OBJ into the project's objects/Mesh folder through Python.
 * The plugin never uses a browser download for OBJ files: Designer's download
 * handler files them under objects/meshfromobj, which must not exist.
 */
export async function saveObjToDesigner(name: string, objText: string): Promise<string> {
  const res = await callPython<{ ok: boolean; path?: string; error?: string }>(
    `return save_obj(${pyStr(name)}, ${pyStr(objText)})`,
  );
  if (!res?.ok) throw new Error(res?.error || "Designer did not confirm the OBJ save.");
  return res.path ?? `objects/Mesh/${name}.obj`;
}

export interface PopulationMaskResult {
  ok: boolean;
  path?: string;
  assigned?: boolean;
  screen?: string;
  screenResolution?: [number, number];
  error?: string;
}

/** Write objects/DxTexture/<fileName>.png and optionally set it as the LED screen's population mask. */
export async function savePopulationMaskToDesigner(
  screenName: string,
  fileName: string,
  pngBase64: string,
  assign: boolean,
): Promise<PopulationMaskResult> {
  const res = await callPython<PopulationMaskResult>(
    `return save_population_mask(${pyStr(screenName)}, ${pyStr(fileName)}, ${pyStr(pngBase64)}, ${assign ? "True" : "False"})`,
  );
  if (!res) throw new Error("Designer did not answer the population mask request.");
  return res;
}

/** Write objects/VideoFile/TestPattern/<fileName>.png (folder created if missing). */
export async function saveTestPatternToDesigner(fileName: string, pngBase64: string): Promise<string> {
  const res = await callPython<{ ok: boolean; path?: string; error?: string }>(
    `return save_test_pattern(${pyStr(fileName)}, ${pyStr(pngBase64)})`,
  );
  if (!res?.ok) throw new Error(res?.error || "Designer did not confirm the test pattern.");
  return res.path ?? `objects/VideoFile/TestPattern/${fileName}.png`;
}

/**
 * Wait for Designer to load the OBJ that save_obj just wrote, then create or
 * update the LED screen resource and add it to the stage.
 */
export async function createLedScreen(
  name: string,
  width: number,
  height: number,
  onProgress: (message: string) => void,
): Promise<{ name: string; resolution: [number, number] }> {
  const deadline = Date.now() + 30000;
  const retryDelays = [250, 500, 1000, 1500, 2000];
  let attempt = 0;
  let lastError = "Designer did not detect a valid exported mesh.";
  while (Date.now() < deadline) {
    attempt += 1;
    onProgress(`Waiting for Designer to load the OBJ (attempt ${attempt})…`);
    const data = await callPython<any>(`return create_led_screen(${pyStr(name)}, ${width}, ${height})`);
    if (data?.ok === true) return { name: data.name, resolution: data.resolution };
    if (!data?.pending) throw new Error(data?.error || "Designer did not confirm LED screen creation.");
    lastError = data.error || lastError;
    const wait = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)];
    await delay(Math.min(wait, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for the OBJ after 30 seconds. Last error: ${lastError}`);
}

/* ---------------- OBJ import ---------------- */

export interface ProjectMeshScreen {
  name: string;
  resolution: [number, number];
}

export interface ProjectMesh {
  path: string;
  size: number;
  /** LED screens of the project that use this mesh. */
  screens: ProjectMeshScreen[];
}

/** OBJ files in objects/Mesh (and legacy objects/meshfromobj). */
export async function listProjectMeshes(): Promise<ProjectMesh[]> {
  const res = await callPython<{ ok: boolean; meshes?: ProjectMesh[]; error?: string }>("return list_meshes()");
  if (!res?.ok) throw new Error(res?.error || "Designer did not list the project meshes.");
  return res.meshes ?? [];
}

export async function readProjectMesh(path: string): Promise<{ path: string; text: string; screens: ProjectMeshScreen[] }> {
  const res = await callPython<{ ok: boolean; path?: string; text?: string; screens?: ProjectMeshScreen[]; error?: string }>(
    `return read_mesh(${pyStr(path)})`,
  );
  if (!res?.ok || typeof res.text !== "string") throw new Error(res?.error || `Designer could not read ${path}.`);
  return { path: res.path ?? path, text: res.text, screens: res.screens ?? [] };
}
