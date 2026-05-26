<script setup lang="ts">
import { computed } from 'vue';
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
  const list: PropertyCard[] = props.state.sections.map((section) => ({
    kind: 'section',
    key: `section:${section.title}`,
    order: section.order,
    section,
  }));

  if (props.state.subsystemSnapshot) {
    list.push({ kind: 'subsystems', key: 'extra:subsystems', order: 20 });
  }

  if (props.state.exchangePlanContentSnapshot) {
    list.push({ kind: 'exchangePlanContent', key: 'extra:exchangePlanContent', order: 140 });
  }

  return list.sort((a, b) => a.order - b.order);
});

const hasContent = computed(() => cards.value.length > 0);

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
        <section v-if="card.kind === 'section'" class="property-section">
          <h3 class="section-title">{{ card.section.title }}</h3>
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
        </section>

        <SubsystemMembershipCard
          v-else-if="card.kind === 'subsystems' && state.subsystemSnapshot"
          :snapshot="state.subsystemSnapshot"
          :readonly="state.readonly"
          @add="send('openSubsystemMembershipPicker')"
          @remove="send('removeSubsystemMembership', { value: $event })"
        />

        <ExchangePlanContentCard
          v-else-if="card.kind === 'exchangePlanContent' && state.exchangePlanContentSnapshot"
          :snapshot="state.exchangePlanContentSnapshot"
        />
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
  overflow: hidden;
}

.properties-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background, var(--vscode-sidebar-background));
}

.properties-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
}

.readonly-badge {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 2px;
}

.diagnostics-section {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.diagnostic-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 8px;
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
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.property-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.property-section:last-child {
  border-bottom: none;
}

.section-title {
  margin: 0 0 2px 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
}

.section-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty-state {
  padding: 12px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
</style>
