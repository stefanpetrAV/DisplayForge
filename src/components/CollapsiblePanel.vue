<script setup lang="ts">
import { ref } from "vue";

/**
 * Sidebar panel that opens and closes like "Import OBJ". The open state of
 * each panel (by `id`) is remembered in localStorage, so the layout survives
 * reloads of the plugin window.
 */
const props = withDefaults(defineProps<{ id: string; title: string; defaultOpen?: boolean }>(), { defaultOpen: true });

const KEY = `displayforge.panel.${props.id}`;
function readOpen(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? props.defaultOpen : v === "1";
  } catch {
    return props.defaultOpen;
  }
}
const open = ref(readOpen());

function onToggle(e: Event) {
  open.value = (e.target as HTMLDetailsElement).open;
  try {
    localStorage.setItem(KEY, open.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <section class="panel">
    <details class="collapsible" :open="open" @toggle="onToggle">
      <summary>{{ title }}</summary>
      <slot />
    </details>
  </section>
</template>

<style scoped>
.collapsible > summary { cursor: pointer; color: var(--accent); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; user-select: none; }
.collapsible[open] > summary { margin-bottom: 8px; }
</style>
