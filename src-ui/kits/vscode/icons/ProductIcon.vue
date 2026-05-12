<template>
  <span
    class="vscode-kit-product-icon"
    :class="`product-icon-${name}`"
    :aria-hidden="!ariaLabel"
    :aria-label="ariaLabel"
    role="img"
  />
</template>

<script setup lang="ts">
/**
 * Product icon VS Code. Использует встроенные product icon font классы.
 */
withDefaults(defineProps<{
  name: string;
  ariaLabel?: string;
}>(), {
  name: '',
});
</script>

<style scoped>
.vscode-kit-product-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
}
</style>
