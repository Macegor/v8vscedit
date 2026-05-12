<template>
  <i
    class="vscode-kit-vscode-icon"
    :class="`codicon codicon-${name}`"
    :style="{ fontSize: sizePx }"
    :aria-hidden="!ariaLabel"
    :aria-label="ariaLabel"
    role="img"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';

/**
 * Иконка codicon. Рендерит элемент `<i>` с классами codicon.
 * Размер задаётся в пикселях через prop `size`.
 */
const props = withDefaults(defineProps<{
  name: string;
  size?: number;
  ariaLabel?: string;
}>(), {
  name: '',
  size: 16,
});

const sizePx = computed(() => `${props.size}px`);
</script>

<style scoped>
.vscode-kit-vscode-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
</style>
