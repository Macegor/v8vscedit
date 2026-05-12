<script setup lang="ts">
import { ref } from 'vue';
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

const props = defineProps<{
  element: FormPreviewElement;
}>();

const activePage = ref(0);
</script>

<template>
  <div v-if="element.visible" class="onec85-pages">
    <div class="onec85-page-tabs">
      <button
        v-for="(page, idx) in element.children"
        :key="page.id"
        class="onec85-page-tab"
        :class="{ active: idx === activePage }"
        @click="activePage = idx"
      >
        {{ page.title || page.name }}
      </button>
    </div>
    <div class="onec85-page-content">
      <slot :page="element.children[activePage]">
        <div>{{ element.children[activePage]?.title || element.children[activePage]?.name }}</div>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.onec85-pages {
  border: 1px solid var(--onec85-border);
  overflow: hidden;
}

.onec85-page-tabs {
  display: flex;
  background: var(--onec85-bg-toolbar);
  border-bottom: 1px solid var(--onec85-border);
}

.onec85-page-tab {
  padding: 4px 14px;
  background: transparent;
  border: none;
  border-right: 1px solid var(--onec85-border);
  cursor: pointer;
  font-family: var(--onec85-font-family);
  font-size: var(--onec85-font-size);
  color: var(--onec85-text-primary);
}

.onec85-page-tab.active {
  background: var(--onec85-bg-primary);
  font-weight: var(--onec85-font-weight-bold);
}

.onec85-page-content {
  padding: var(--onec85-spacing-sm);
  background: var(--onec85-bg-primary);
}
</style>
