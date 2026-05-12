<script setup lang="ts">
import type { FormElementDto } from '../main';

defineProps<{
  element: FormElementDto;
  mode: 'taxi' | 'onec85';
}>();

function getElementLabel(el: FormElementDto): string {
  return el.title || el.name || el.type;
}
</script>

<template>
  <div class="preview-pane" :class="'preview-' + mode">
    <div class="preview-toolbar" v-if="element.children?.some(c => c.type === 'CommandBar')">
      <div class="preview-command-bar">
        <span class="codicon codicon-three-bars"></span>
        <span class="preview-title">{{ getElementLabel(element) }}</span>
      </div>
    </div>
    <div class="preview-body">
      <template v-for="child in element.children" :key="child.id">
        <!-- UsualGroup -->
        <div v-if="child.type === 'UsualGroup'" class="preview-group" :class="'group-' + (child.group || 'Vertical').toLowerCase()">
          <div v-if="child.title" class="group-title">{{ child.title }}</div>
          <div v-for="sub in child.children" :key="sub.id" class="preview-field">
            <label class="field-label">{{ getElementLabel(sub) }}</label>
            <div class="field-control">
              <span class="field-placeholder">[{{ sub.type }}]</span>
            </div>
          </div>
        </div>
        <!-- Pages -->
        <div v-else-if="child.type === 'Pages'" class="preview-pages">
          <div class="pages-tabs">
            <span v-for="page in child.children" :key="page.id" class="page-tab">
              {{ getElementLabel(page) }}
            </span>
          </div>
        </div>
        <!-- Table -->
        <div v-else-if="child.type === 'Table'" class="preview-table-section">
          <div v-if="child.title" class="table-title">{{ child.title }}</div>
          <table class="preview-table">
            <tr>
              <th v-for="col in child.children" :key="col.id">{{ getElementLabel(col) }}</th>
            </tr>
            <tr>
              <td v-for="col in child.children" :key="col.id" class="table-cell">...</td>
            </tr>
          </table>
        </div>
        <!-- Label decoration -->
        <div v-else-if="child.type === 'LabelDecoration'" class="preview-decoration">
          {{ child.title || child.name }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.preview-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
}

.preview-taxi {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.preview-onec85 {
  font-family: 'Segoe UI', 'Roboto', sans-serif;
}

.preview-toolbar {
  background: var(--vscode-editorWidget-background);
  border-bottom: 1px solid var(--vscode-widget-border);
  padding: 4px 8px;
}

.preview-command-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.preview-title {
  font-weight: 600;
}

.preview-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.group-horizontal {
  flex-direction: row;
  flex-wrap: wrap;
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-editor-foreground);
  margin-bottom: 4px;
}

.preview-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-label {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  min-width: 80px;
}

.field-control {
  flex: 1;
  min-height: 22px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 2px;
  padding: 2px 6px;
}

.field-placeholder {
  font-size: 11px;
  color: var(--vscode-disabledForeground);
}

.preview-pages {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 2px;
}

.pages-tabs {
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--vscode-sidebar-background);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.page-tab {
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 2px;
}

.preview-table-section {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 2px;
}

.table-title {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 8px;
  background: var(--vscode-sidebar-background);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.preview-table th {
  text-align: left;
  padding: 4px 8px;
  background: var(--vscode-sidebar-background);
  border-bottom: 1px solid var(--vscode-panel-border);
  font-weight: 600;
}

.table-cell {
  padding: 4px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  color: var(--vscode-disabledForeground);
}

.preview-decoration {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}
</style>
