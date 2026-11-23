<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { TestPatternLayout } from "../core/testPattern";
import { testPatternFileName, PATTERN_COLORS } from "../core/testPattern";
import { MAX_TEXTURE_SIDE } from "../core/mask";
import { drawTestPattern, type PatternLogos } from "../core/testPatternRender";

const props = defineProps<{
  layout: TestPatternLayout;
  logos: Promise<PatternLogos>;
  isPlugin: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{ generate: [] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const resolvedLogos = ref<PatternLogos>({});
const PREVIEW_W = 560;

function redraw() {
  const c = canvas.value;
  if (!c) return;
  const { width, height } = props.layout;
  const scale = Math.min(PREVIEW_W / width, 320 / height);
  c.width = Math.max(1, Math.round(width * scale));
  c.height = Math.max(1, Math.round(height * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return;
  drawTestPattern(ctx, props.layout, { x: 0, y: 0, width, height }, scale, resolvedLogos.value);
}

onMounted(async () => {
  redraw();
  resolvedLogos.value = await props.logos;
  redraw();
});
watch(() => props.layout, redraw, { deep: true });

const files = computed(() =>
  props.layout.parts.map((p) => ({ name: `${testPatternFileName(props.layout.screenName, p)}.png`, size: `${p.width} × ${p.height} px` })),
);
const split = computed(() => props.layout.parts.length > 1);
/** Seams of the split, as % of the preview, to draw on top. */
const seams = computed(() =>
  props.layout.parts.filter((p) => p.x > 0).map((p) => (p.x / props.layout.width) * 100),
);
const disguiseMissing = computed(() => props.isPlugin && !resolvedLogos.value.disguise);
</script>

<template>
  <div class="patterns">
    <p class="hint">
      One checkerboard cell per tile: neutral grey alternating with
      <span v-for="c in PATTERN_COLORS" :key="c.name" class="swatch" :style="{ background: `rgb(${c.rgb.join(',')})` }">{{ c.name }}</span>,
      screen name in the centre, absent tiles black.
    </p>
    <div class="preview-wrap">
      <canvas ref="canvas" class="preview" />
      <div v-for="(x, i) in seams" :key="i" class="seam" :style="{ left: `${x}%` }" />
    </div>
    <ul class="files">
      <li v-for="f in files" :key="f.name"><code>{{ f.name }}</code> · {{ f.size }}</li>
    </ul>
    <p v-if="split" class="warn">
      The screen is wider or taller than {{ MAX_TEXTURE_SIDE }} px: the pattern is split into {{ layout.parts.length }} equal parts on tile edges.
    </p>
    <p v-if="disguiseMissing" class="warn">
      Disguise logo not found (<code>brand/disguise-logo-white.svg</code>): the pattern is signed with DisplayForge only.
    </p>
    <div class="buttons">
      <button type="button" class="primary" :disabled="busy" @click="emit('generate')">
        {{ isPlugin ? "Save test pattern to objects/DxTexture" : "Download test pattern" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.patterns { display: flex; flex-direction: column; gap: 8px; }
.preview-wrap { position: relative; align-self: flex-start; max-width: 100%; line-height: 0; }
.preview { max-width: 100%; border: 1px solid var(--border); border-radius: 4px; }
.seam { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px dashed #e0b050; }
.files { margin: 0; padding-left: 18px; font-size: 12px; color: var(--text-secondary); }
.swatch { display: inline-block; min-width: 16px; padding: 0 3px; margin: 0 1px; border-radius: 3px; color: #fff; font-size: 11px; text-align: center; }
.warn { font-size: 11px; color: #e0b050; }
.buttons { display: flex; gap: 6px; }
code { font-size: 11px; color: var(--text-secondary); }
</style>
