<script setup lang="ts">
import type { ExchangePlanContentSnapshot } from '@ui-shared/types/property';

defineProps<{
  snapshot: ExchangePlanContentSnapshot;
}>();
</script>

<template>
  <section class="property-section">
    <h3 class="section-title">Обмен данными</h3>
    <div v-if="snapshot.items.length === 0" class="empty">Объект не входит ни в один план обмена.</div>
    <div v-else class="reference-table" role="table" aria-label="Обмен данными">
      <div class="reference-table-header" role="row">
        <div role="columnheader">План обмена</div>
        <div role="columnheader">Авторегистрация</div>
      </div>
      <div v-for="item in snapshot.items" :key="item.exchangePlanName" class="reference-table-row" role="row">
        <div class="reference-table-cell" role="cell" :title="item.exchangePlanName">{{ item.exchangePlanLabel }}</div>
        <div class="reference-table-cell" role="cell" :title="item.autoRecord">{{ item.autoRecordLabel }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.property-section {
  position: relative;
  display: grid;
  gap: 12px;
  min-width: 0;
  box-sizing: border-box;
  margin: 10px 0 0;
  padding: 22px 16px 16px;
  border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.section-title {
  position: absolute;
  top: -12px;
  left: 14px;
  margin: 0;
  padding: 0 8px;
  background: linear-gradient(
    to bottom,
    transparent calc(50% - 1px),
    var(--vscode-sideBar-background) calc(50% - 1px),
    var(--vscode-sideBar-background) calc(50% + 1px),
    transparent calc(50% + 1px)
  );
  font-size: 17px;
  line-height: 1.25;
  font-weight: 700;
}

.reference-table {
  display: grid;
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 6px;
  overflow: hidden;
  background: var(--vscode-input-background);
}

.reference-table-header,
.reference-table-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(120px, 0.45fr);
  min-width: 0;
}

.reference-table-header {
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-sideBar-background);
  font-weight: 600;
}

.reference-table-header + .reference-table-row,
.reference-table-row + .reference-table-row {
  border-top: 1px solid var(--vscode-input-border, transparent);
}

.reference-table-cell,
.reference-table-header > div {
  min-width: 0;
  padding: 7px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-table-cell + .reference-table-cell,
.reference-table-header > div + div {
  border-left: 1px solid var(--vscode-input-border, transparent);
}

.empty {
  padding: 12px;
  color: var(--vscode-descriptionForeground);
  border: 1px dashed var(--vscode-panel-border, var(--vscode-input-border, transparent));
  border-radius: 6px;
}

@media (max-width: 760px) {
  .reference-table-header,
  .reference-table-row {
    grid-template-columns: minmax(0, 1fr) minmax(96px, 0.55fr);
  }
}
</style>
