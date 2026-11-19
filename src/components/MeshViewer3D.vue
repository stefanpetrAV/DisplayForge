<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MeshData } from "../core/types";

const props = defineProps<{ entries: Array<{ id: string; isActive: boolean; mesh: MeshData | null }> }>();

const container = ref<HTMLDivElement | null>(null);
const status = ref<"checking" | "ready" | "unavailable">("checking");
const reason = ref("");

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let resizeObserver: ResizeObserver | null = null;
let frame = 0;
let framedKey = "";
const objects = shallowRef<THREE.Object3D[]>([]);

function clearObjects() {
  for (const o of objects.value) {
    scene?.remove(o);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
  objects.value = [];
}

function geometryOf(mesh: MeshData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return g;
}

function rebuild() {
  if (!scene) return;
  clearObjects();
  const added: THREE.Object3D[] = [];
  const box = new THREE.Box3();
  for (const e of props.entries) {
    if (!e.mesh || e.mesh.indices.length === 0) continue;
    const g = geometryOf(e.mesh);
    // Front faces in the screen colour, back faces dark so the facing direction is obvious.
    const front = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        color: e.isActive ? 0xff5a1f : 0x5a6472,
        side: THREE.FrontSide,
        metalness: 0.1,
        roughness: 0.8,
      }),
    );
    const back = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x262626, side: THREE.BackSide }));
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(g, 1),
      new THREE.LineBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.4 }),
    );
    for (const o of [front, back, edges]) {
      scene.add(o);
      added.push(o);
    }
    box.expandByObject(front);
  }
  objects.value = added;
  const key = props.entries.map((e) => e.id).join(",");
  if (key !== framedKey && !box.isEmpty()) {
    frameBox(box);
    framedKey = key;
  }
}

function frameBox(box: THREE.Box3) {
  if (!camera || !controls) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(0.5, size.length() / 2);
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360);
  // Seen from the front (+Z), slightly from the right and above.
  camera.position.set(center.x + dist * 0.35, center.y + dist * 0.3, center.z + dist * 0.9);
  controls.target.copy(center);
  controls.update();
}

function resetView() {
  const box = new THREE.Box3();
  for (const o of objects.value) box.expandByObject(o);
  if (!box.isEmpty()) frameBox(box);
}

function resize() {
  const el = container.value;
  if (!el || !renderer || !camera) return;
  const w = Math.max(1, el.clientWidth);
  const h = Math.max(1, el.clientHeight);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function loop() {
  frame = requestAnimationFrame(loop);
  controls?.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function dispose() {
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  resizeObserver = null;
  clearObjects();
  controls?.dispose();
  renderer?.dispose();
  if (renderer && container.value?.contains(renderer.domElement)) container.value.removeChild(renderer.domElement);
  renderer = null;
  scene = null;
  camera = null;
  controls = null;
  framedKey = "";
}

function init() {
  const el = container.value;
  if (!el) return;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, failIfMajorPerformanceCaveat: false });
  } catch (e) {
    status.value = "unavailable";
    reason.value = e instanceof Error ? e.message : String(e);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    status.value = "unavailable";
    reason.value = "WebGL context was lost.";
  });
  el.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141414);
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(4, 6, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-5, 2, 4);
  scene.add(fill);
  scene.add(new THREE.GridHelper(20, 20, 0x3a3a3a, 0x262626));
  scene.add(new THREE.AxesHelper(1));
  status.value = "ready";
  resize();
  rebuild();
  loop();
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(el);
}

function retry() {
  dispose();
  status.value = "checking";
  requestAnimationFrame(init);
}

onMounted(init);
onBeforeUnmount(dispose);
watch(() => props.entries, () => status.value === "ready" && rebuild());

defineExpose({ resetView });
</script>

<template>
  <div class="viewer-wrap">
    <div ref="container" class="viewer3d" />
    <button v-if="status === 'ready'" type="button" class="reset-view" title="Frame all screens" @click="resetView">Frame</button>
    <div v-if="status === 'unavailable'" class="viewer-fallback">
      <p class="fallback-title">3D preview unavailable in this panel</p>
      <p>WebGL could not be initialised. Use the standalone page in a regular browser for the 3D preview.</p>
      <p class="fallback-detail">{{ reason }}</p>
      <button type="button" class="ghost" @click="retry">Retry</button>
    </div>
  </div>
</template>

<style scoped>
.viewer-wrap { position: relative; width: 100%; height: 100%; min-height: 200px; }
.viewer3d { width: 100%; height: 100%; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); }
.viewer3d :deep(canvas) { display: block; width: 100%; height: 100%; }
.reset-view { position: absolute; top: 8px; right: 8px; background: var(--panel-alt); border: 1px solid var(--border); color: var(--text-secondary); border-radius: 3px; font-size: 11px; padding: 4px 8px; cursor: pointer; }
.reset-view:hover { color: var(--accent); border-color: var(--accent); }
.viewer-fallback { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 20px; border-radius: 6px; border: 1px dashed var(--border); background: var(--input-bg); color: var(--text-secondary); font-size: 12px; }
.fallback-title { color: var(--accent); font-weight: 600; font-size: 13px; }
.fallback-detail { font-family: monospace; color: var(--text-muted); font-size: 11px; }
</style>
