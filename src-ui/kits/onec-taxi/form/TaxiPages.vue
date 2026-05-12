<script setup lang="ts">
import { ref } from 'vue';
import type { FormPreviewElement } from '../../../apps/form-editor/preview-core/types/FormPreviewElement';

const props = defineProps<{
  element: FormPreviewElement;
}>();

const activePage = ref(0);
</script>

<template>
  <div v-if="element.visible" class="taxi-pages">
    <div class="taxi-page-tabs">
      <button
        v-for="(page, idx) in element.children"
        :key="page.id"
        class="taxi-page-tab"
        :class="{ active: idx === activePage }"
        @click="activePage = idx"
      >
        {{ page.title || page.name }}
      </button>
    </div>
    <div class="taxi-page-content">
      <slot :page="element.children[activePage]">
        <div>{{ element.children[activePage]?.title || element.children[activePage]?.name }}</div>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.taxi-pages {
  border: 1px solid var(--taxi-border);
  border-radius: 3px;
  overflow: hidden;
}

.taxi-page-tabs {
  display: flex;
  background: var(--taxi-bg-toolbar);
  border-bottom: 1px solid var(--taxi-border);
}

.taxi-page-tab {
  padding: 6px 16px;
  background: transparent;
  border: none;
  border-right: 1px solid var(--taxi-border);
  cursor: pointer;
  font-family: var(--taxi-font-family);
  font-size: var(--taxi-font-size);
  color: var(--taxi-text-primary);
}

.taxi-page-tab.active {
  background: var(--taxi-bg-secondary);
  font-weight: var(--taxi-font-weight-bold);
}

.taxi-page-content {
  padding: var(--taxi-spacing-md);
  background: var(--taxi-bg-secondary);
}
</style>
