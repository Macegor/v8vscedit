<script setup lang="ts">
import type { ExchangePlanContentSnapshot } from '@ui-shared/types/property';

defineProps<{
  snapshot: ExchangePlanContentSnapshot;
}>();
</script>

<template>
  <div class="exchange-plan-content">
    <div v-if="snapshot.items.length === 0" class="empty">Объект не входит ни в один план обмена.</div>
    <div v-else class="exchange-table" role="table" aria-label="Обмен данными">
      <div class="exchange-row exchange-row--header" role="row">
        <div role="columnheader">План обмена</div>
        <div role="columnheader">Авторегистрация</div>
      </div>
      <div v-for="item in snapshot.items" :key="item.exchangePlanName" class="exchange-row" role="row">
        <div class="exchange-cell" role="cell" :title="item.exchangePlanName">{{ item.exchangePlanLabel }}</div>
        <div class="exchange-cell" role="cell" :title="item.autoRecord">{{ item.autoRecordLabel }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.exchange-plan-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.empty {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.4;
}

.exchange-table {
  display: flex;
  flex-direction: column;
}

.exchange-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(100px, 0.45fr);
  gap: 8px;
  min-height: 22px;
  align-items: center;
}

.exchange-row--header {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.exchange-cell,
.exchange-row--header > div {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
