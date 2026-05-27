<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  PropertiesViewState,
  PropertyControl,
  PropertySectionDto,
} from '@ui-shared/types/property';
import PropertyTextControl from './controls/PropertyTextControl.vue';
import PropertyBooleanControl from './controls/PropertyBooleanControl.vue';
import PropertyEnumControl from './controls/PropertyEnumControl.vue';
import PropertyTypeControl from './controls/PropertyTypeControl.vue';
import PropertyReferenceListControl from './controls/PropertyReferenceListControl.vue';
import PropertyFormsSection from './controls/PropertyFormsSection.vue';
import SubsystemMembershipCard from './controls/SubsystemMembershipCard.vue';
import ExchangePlanContentCard from './controls/ExchangePlanContentCard.vue';

const props = defineProps<{
  state: PropertiesViewState;
}>();

const emit = defineEmits<{
  command: [name: string, payload?: Record<string, unknown>];
}>();

type PropertyCard =
  | { readonly kind: 'section'; readonly key: string; readonly order: number; readonly section: PropertySectionDto }
  | { readonly kind: 'subsystems'; readonly key: string; readonly order: number }
  | { readonly kind: 'exchangePlanContent'; readonly key: string; readonly order: number };

const cards = computed<PropertyCard[]>(() => {
  // Сортируем только секции свойств по их order.
  const sectionCards: PropertyCard[] = props.state.sections
    .map((section) => ({
      kind: 'section' as const,
      key: `section:${section.title}`,
      order: section.order,
      section,
    }))
    .sort((a, b) => a.order - b.order);

  // Подсистемы и обмен данными — служебные блоки, всегда в конце списка,
  // независимо от order секций (у некоторых объектов секции без явного order).
  const extraCards: PropertyCard[] = [];
  if (props.state.subsystemSnapshot) {
    extraCards.push({ kind: 'subsystems', key: 'extra:subsystems', order: 0 });
  }
  if (props.state.exchangePlanContentSnapshot) {
    extraCards.push({ kind: 'exchangePlanContent', key: 'extra:exchangePlanContent', order: 0 });
  }

  return [...sectionCards, ...extraCards];
});

const hasContent = computed(() => cards.value.length > 0);

const MAIN_SECTION_TITLE = 'Основные';

const collapsed = ref<Set<string>>(new Set());

/** При смене объекта раскрываем только «Основные» (или первую секцию), остальные сворачиваем. */
function resetCollapsed(): void {
  const list = cards.value;
  if (list.length === 0) {
    collapsed.value = new Set();
    return;
  }
  const mainCard =
    list.find((card) => card.kind === 'section' && card.section.title === MAIN_SECTION_TITLE) ?? list[0];
  const next = new Set<string>();
  for (const card of list) {
    if (card.key !== mainCard.key) {
      next.add(card.key);
    }
  }
  collapsed.value = next;
}

watch(() => props.state.title, () => resetCollapsed(), { immediate: true });

function isCollapsed(key: string): boolean {
  return collapsed.value.has(key);
}

function toggleSection(key: string): void {
  const next = new Set(collapsed.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  collapsed.value = next;
}

function isTextControl(control: PropertyControl): boolean {
  return control.kind === 'string' || control.kind === 'localizedString';
}

function isEnumControl(control: PropertyControl): boolean {
  return control.kind === 'enum' || control.kind === 'multiEnum';
}

function readonlyText(): string {
  if (props.state.readonlyReason === 'support') {
    return 'Только чтение: объект на поддержке';
  }
  if (props.state.readonlyReason === 'repository') {
    return 'Только чтение: объект не захвачен в хранилище';
  }
  return 'Только чтение';
}

function send(name: string, payload?: Record<string, unknown>): void {
  emit('command', name, payload);
}

function onControlChanged(control: PropertyControl, value: unknown): void {
  if (props.state.readonly) return;
  send('propertyChanged', { key: control.id, value });
}
</script>

<template>
  <div class="properties-view">
    <header class="properties-header">
      <h2 class="properties-title">{{ state.title }}</h2>
      <span v-if="state.readonly" class="readonly-badge">{{ readonlyText() }}</span>
    </header>

    <div v-if="state.diagnostics?.length" class="diagnostics-section">
      <div
        v-for="d in state.diagnostics"
        :key="d.message"
        class="diagnostic-item"
        :class="'diagnostic-' + d.kind"
      >
        <span class="diagnostic-icon" aria-hidden="true">
          {{ d.kind === 'error' ? '!' : d.kind === 'warning' ? '?' : 'i' }}
        </span>
        <span class="diagnostic-message">{{ d.message }}</span>
      </div>
    </div>

    <div v-if="hasContent" class="sections-list">
      <template v-for="card in cards" :key="card.key">
        <section
          v-if="card.kind === 'section'"
          class="property-section"
          :class="{ 'is-expanded': !isCollapsed(card.key) }"
        >
          <button type="button" class="section-header" @click="toggleSection(card.key)">
            <span
              class="section-chevron codicon"
              :class="isCollapsed(card.key) ? 'codicon-chevron-right' : 'codicon-chevron-down'"
              aria-hidden="true"
            ></span>
            <span class="section-title">{{ card.section.title }}</span>
          </button>
          <div v-show="!isCollapsed(card.key)" class="section-body">
            <PropertyFormsSection
              v-if="card.section.title === 'Формы'"
              :controls="card.section.controls"
              :readonly="state.readonly"
              @pick="send('openFormPicker', { key: $event })"
              @clear="send('clearFormProperty', { key: $event })"
            />
            <div v-else class="section-controls">
              <template v-for="control in card.section.controls" :key="control.id">
                <PropertyTextControl
                  v-if="isTextControl(control)"
                  :control="control"
                  :readonly="state.readonly"
                  @change="onControlChanged(control, $event)"
                  @invalid-name="send('invalidName')"
                />
                <PropertyBooleanControl
                  v-else-if="control.kind === 'boolean'"
                  :control="control"
                  :readonly="state.readonly"
                  @change="onControlChanged(control, $event)"
                />
                <PropertyEnumControl
                  v-else-if="isEnumControl(control)"
                  :control="control"
                  :readonly="state.readonly"
                  @change="onControlChanged(control, $event)"
                />
                <PropertyTypeControl
                  v-else-if="control.kind === 'metadataType'"
                  :control="control"
                  :readonly="state.readonly"
                  @open-picker="send('openTypePicker', $event)"
                  @update-qualifiers="send('updateTypeQualifiers', $event)"
                />
                <PropertyReferenceListControl
                  v-else-if="control.kind === 'metadataReferenceList'"
                  :control="control"
                  :readonly="state.readonly"
                  @add="send('openMetadataReferencePicker', { key: $event })"
                  @remove="send('removeMetadataReference', $event)"
                />
              </template>
            </div>
          </div>
        </section>

        <section
          v-else-if="card.kind === 'subsystems' && state.subsystemSnapshot"
          class="property-section"
          :class="{ 'is-expanded': !isCollapsed(card.key) }"
        >
          <button type="button" class="section-header" @click="toggleSection(card.key)">
            <span
              class="section-chevron codicon"
              :class="isCollapsed(card.key) ? 'codicon-chevron-right' : 'codicon-chevron-down'"
              aria-hidden="true"
            ></span>
            <span class="section-title">Подсистемы</span>
          </button>
          <div v-show="!isCollapsed(card.key)" class="section-body">
            <SubsystemMembershipCard
              :snapshot="state.subsystemSnapshot"
              :readonly="state.readonly"
              @add="send('openSubsystemMembershipPicker')"
              @remove="send('removeSubsystemMembership', { value: $event })"
            />
          </div>
        </section>

        <section
          v-else-if="card.kind === 'exchangePlanContent' && state.exchangePlanContentSnapshot"
          class="property-section"
          :class="{ 'is-expanded': !isCollapsed(card.key) }"
        >
          <button type="button" class="section-header" @click="toggleSection(card.key)">
            <span
              class="section-chevron codicon"
              :class="isCollapsed(card.key) ? 'codicon-chevron-right' : 'codicon-chevron-down'"
              aria-hidden="true"
            ></span>
            <span class="section-title">Обмен данными</span>
          </button>
          <div v-show="!isCollapsed(card.key)" class="section-body">
            <ExchangePlanContentCard :snapshot="state.exchangePlanContentSnapshot" />
          </div>
        </section>
      </template>
    </div>

    <div v-else class="empty-state">
      <p>Для выбранного объекта свойства не отображаются.</p>
    </div>
  </div>
</template>

<style scoped>
.properties-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.properties-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.properties-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-foreground);
}

.readonly-badge {
  font-size: 11px;
  padding: 1px 5px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 2px;
}

.diagnostics-section {
  padding: 4px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.diagnostic-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 2px;
  font-size: 12px;
}

.diagnostic-error {
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  color: var(--vscode-errorForeground);
}

.diagnostic-warning {
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  color: var(--vscode-list-warningForeground);
}

.diagnostic-info {
  color: var(--vscode-descriptionForeground);
}

.diagnostic-icon {
  font-weight: bold;
  font-size: 14px;
  min-width: 16px;
  text-align: center;
}

.sections-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding-right: 6px;
}

.property-section {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.property-section:last-child {
  border-bottom: none;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 0;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.section-chevron {
  width: 16px;
  font-size: 16px;
  flex-shrink: 0;
  text-align: center;
  opacity: 0.8;
}

.section-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Линия 3px проходит вертикально под центром иконки сворачивания (≈8px). */
  margin-left: 6px;
  padding: 0 0 8px 12px;
  border-left: 3px solid transparent;
}

.property-section.is-expanded .section-body {
  border-left-color: var(--vscode-focusBorder);
}

.section-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  padding: 6px 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
</style>
