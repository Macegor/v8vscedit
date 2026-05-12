<template>
  <div class="vscode-kit-empty-state" role="status">
    <p v-if="title" class="vscode-kit-empty-state__title">{{ title }}</p>
    <p v-if="description" class="vscode-kit-empty-state__description">{{ description }}</p>
    <button
      v-if="actionLabel"
      class="vscode-kit-empty-state__action vscode-kit-button vscode-kit-button--secondary"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Пустое состояние для списков и деревьев.
 * Показывает заголовок, описание и опциональную кнопку действия.
 */
withDefaults(defineProps<{
  title?: string;
  description?: string;
  actionLabel?: string;
}>(), {
  title: '',
  description: '',
  actionLabel: '',
});

const emit = defineEmits<{
  action: [];
}>();
</script>

<style scoped>
.vscode-kit-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--vscode-kit-spacing-4);
  padding: var(--vscode-kit-spacing-8) var(--vscode-kit-spacing-6);
  text-align: center;
  color: var(--vscode-kit-descriptionForeground);
  font-family: var(--vscode-kit-font-family);
  font-size: var(--vscode-kit-font-size);
  line-height: var(--vscode-kit-line-height);
}
.vscode-kit-empty-state__title {
  margin: 0;
  font-weight: var(--vscode-kit-font-weight-bold);
  color: var(--vscode-kit-foreground);
}
.vscode-kit-empty-state__description {
  margin: 0;
  max-width: 300px;
}
.vscode-kit-empty-state__action {
  margin-top: var(--vscode-kit-spacing-4);
}
</style>
