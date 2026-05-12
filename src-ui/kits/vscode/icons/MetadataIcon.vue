<template>
  <span class="vscode-kit-metadata-icon" aria-hidden="true">
    <picture v-if="icon.kind === 'asset' || icon.kind === 'metadata'" class="vscode-kit-metadata-icon__picture">
      <source v-if="icon.darkUri" :srcset="icon.darkUri" media="(prefers-color-scheme: dark)" />
      <img
        v-if="icon.lightUri"
        :src="icon.lightUri"
        class="vscode-kit-metadata-icon__img"
        :alt="icon.ariaLabel || ''"
      />
      <span v-else class="vscode-kit-metadata-icon__placeholder" />
    </picture>
    <i
      v-else-if="icon.kind === 'codicon' && icon.name"
      :class="`codicon codicon-${icon.name}`"
      :aria-label="icon.ariaLabel"
      role="img"
    />
    <span v-else class="vscode-kit-metadata-icon__placeholder" />
  </span>
</template>

<script setup lang="ts">
import type { IconDto } from '@ui-shared/types/icon';

/**
 * Иконка метаданных. Рендерит картинку с поддержкой светлой/тёмной темы
 * через `<picture>`, либо codicon, либо пустой placeholder.
 */
withDefaults(defineProps<{
  icon?: IconDto;
}>(), {
  icon: () => ({ kind: 'none' as const }),
});
</script>

<style scoped>
.vscode-kit-metadata-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  min-width: 16px;
  flex-shrink: 0;
}
.vscode-kit-metadata-icon__picture {
  display: flex;
}
.vscode-kit-metadata-icon__img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}
.vscode-kit-metadata-icon__placeholder {
  width: 16px;
  height: 16px;
}
</style>
