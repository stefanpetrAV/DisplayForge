<script setup lang="ts">
/**
 * Number input that only emits valid, finite values. While the user is typing
 * an incomplete value ("", "-", "1e") nothing is emitted; on blur the field
 * snaps back to the current model value.
 */
import { ref, watch } from "vue";

const props = defineProps<{
  label: string;
  modelValue: number;
  min?: number;
  max?: number;
  step?: number | string;
  integer?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const text = ref(String(props.modelValue));
watch(
  () => props.modelValue,
  (v) => {
    if (Number(text.value) !== v) text.value = String(v);
  },
);

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value;
  if (text.value.trim() === "") return;
  let n = Number(text.value);
  if (!Number.isFinite(n)) return;
  if (props.integer) n = Math.round(n);
  if (props.min !== undefined && n < props.min) return;
  if (props.max !== undefined && n > props.max) return;
  if (n !== props.modelValue) emit("update:modelValue", n);
}

function onBlur() {
  text.value = String(props.modelValue);
}
</script>

<template>
  <label class="field">
    <span>{{ label }}</span>
    <input type="number" :value="text" :min="min" :max="max" :step="step ?? (integer ? 1 : 'any')" @input="onInput" @blur="onBlur" />
  </label>
</template>
