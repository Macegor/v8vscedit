<template>
  <span class="vscode-kit-tree-icon" aria-hidden="true">
    <img
      v-if="icon.kind === 'asset' && icon.lightUri"
      :src="icon.lightUri"
      class="vscode-kit-tree-icon__img"
      alt=""
    />
    <img
      v-else-if="icon.kind === 'metadata' && icon.lightUri"
      :src="icon.lightUri"
      class="vscode-kit-tree-icon__img"
      alt=""
    />
    <i
      v-else-if="icon.kind === 'codicon' && icon.name"
      :class="`codicon codicon-${icon.name}`"
    />
    <span v-else class="vscode-kit-tree-icon__placeholder" />
  </span>
</template>

<script setup lang="ts">
import type { IconDto } from '@ui-shared/types/icon';

/**
 * Иконка узла дерева. Понимает все виды IconDto:
 * - `codicon` — class на codicon
 * - `asset` / `metadata` — img с lightUri
 * - `none` — пустой placeholder
 */
withDefaults(defineProps<{
  icon?: IconDto;
}>(), {
  icon: () => ({ kind: 'none' as const }),
});
</script>

<style scoped>
.vscode-kit-tree-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  min-width: 16px;
  flex-shrink: 0;
  font-size: 14px;
  line-height: 1;
}
.vscode-kit-tree-icon__img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}
.vscode-kit-tree-icon__placeholder {
  width: 16px;
  height: 16px;
}
</style>
