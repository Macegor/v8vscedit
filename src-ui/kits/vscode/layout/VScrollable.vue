<template>
  <div
    class="vscode-kit-scrollable"
    :class="{ 'vscode-kit-scrollable--horizontal': horizontal }"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * Прокручиваемый контейнер с нативным скроллом VS Code.
 * Стили скроллбара наследуются от webview.
 */
withDefaults(defineProps<{
  horizontal?: boolean;
}>(), {
  horizontal: false,
});
</script>

<style scoped>
.vscode-kit-scrollable {
  overflow-y: auto;
  overflow-x: hidden;
  height: 100%;
}
.vscode-kit-scrollable--horizontal {
  overflow-x: auto;
  overflow-y: hidden;
}
</style>
