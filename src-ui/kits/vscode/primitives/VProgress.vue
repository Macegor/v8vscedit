<template>
  <div
    class="vscode-kit-progress"
    :class="{ 'vscode-kit-progress--indeterminate': indeterminate }"
    role="progressbar"
    :aria-valuenow="indeterminate ? undefined : value"
    :aria-valuemin="0"
    :aria-valuemax="100"
  >
    <div
      class="vscode-kit-progress__bar"
      :style="indeterminate ? undefined : { width: `${value}%` }"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Прогресс-бар в стиле VS Code.
 * При `indeterminate` работает бесконечная анимация (для неизвестной длительности).
 */
withDefaults(defineProps<{
  value?: number;
  indeterminate?: boolean;
}>(), {
  value: 0,
  indeterminate: false,
});
</script>

<style scoped>
.vscode-kit-progress {
  width: 100%;
  height: 4px;
  background: var(--vscode-kit-panelBackground);
  border-radius: 2px;
  overflow: hidden;
}
.vscode-kit-progress__bar {
  height: 100%;
  background: var(--vscode-kit-progressBarBackground);
  border-radius: 2px;
  transition: width 200ms ease;
}
.vscode-kit-progress--indeterminate .vscode-kit-progress__bar {
  width: 30% !important;
  animation: vscode-kit-progress-indeterminate 1.5s ease-in-out infinite;
}
@keyframes vscode-kit-progress-indeterminate {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(200%); }
  100% { transform: translateX(300%); }
}
</style>
