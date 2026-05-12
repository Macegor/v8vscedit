<template>
  <span class="vscode-kit-tree-search-highlight">
    <template v-for="(part, index) in parts" :key="index">
      <mark v-if="part.match" class="vscode-kit-tree-search-highlight__mark">{{ part.text }}</mark>
      <span v-else>{{ part.text }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/**
 * Подсветка совпадений поискового запроса в тексте.
 * Разбивает текст на части, совпадающие/не совпадающие с query.
 */
const props = withDefaults(defineProps<{
  text: string;
  query: string;
}>(), {
  text: '',
  query: '',
});

interface HighlightPart {
  text: string;
  match: boolean;
}

const parts = computed<HighlightPart[]>(() => {
  if (!props.query || !props.text) {
    return [{ text: props.text, match: false }];
  }
  const result: HighlightPart[] = [];
  const lowerText = props.text.toLowerCase();
  const lowerQuery = props.query.toLowerCase();
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQuery, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) {
      result.push({ text: props.text.slice(lastIndex, idx), match: false });
    }
    result.push({ text: props.text.slice(idx, idx + props.query.length), match: true });
    lastIndex = idx + props.query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }
  if (lastIndex < props.text.length) {
    result.push({ text: props.text.slice(lastIndex), match: false });
  }
  return result;
});
</script>

<style scoped>
.vscode-kit-tree-search-highlight {
  white-space: nowrap;
}
.vscode-kit-tree-search-highlight__mark {
  background: rgba(150, 120, 0, 0.3);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
</style>
