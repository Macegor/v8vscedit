<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { MessageBus } from '@ui-shared/api/messageBus';
import type { HostToUiMessage } from '@ui-shared/protocol/hostMessages';
import type { PropertiesViewState, PropertyControl, PropertySectionDto } from '@ui-shared/types/property';
import PropertyTextControl from './controls/PropertyTextControl.vue';
import PropertyBooleanControl from './controls/PropertyBooleanControl.vue';
import PropertyEnumControl from './controls/PropertyEnumControl.vue';
import PropertyTypeControl from './controls/PropertyTypeControl.vue';
import PropertyReferenceListControl from './controls/PropertyReferenceListControl.vue';
import PropertyFormsSection from './controls/PropertyFormsSection.vue';
import SubsystemMembershipCard from './controls/SubsystemMembershipCard.vue';
import ExchangePlanContentCard from './controls/ExchangePlanContentCard.vue';

const props = defineProps<{
  initialState: PropertiesViewState | null;
  messageBus: MessageBus;
}>();

const title = ref(props.initialState?.title ?? '');
const sections = ref(props.initialState?.sections ?? []);
const readonly = ref(props.initialState?.readonly ?? false);
const readonlyReason = ref(props.initialState?.readonlyReason);
const diagnostics = ref(props.initialState?.diagnostics ?? []);
const subsystemSnapshot = ref(props.initialState?.subsystemSnapshot ?? null);
const exchangePlanContentSnapshot = ref(props.initialState?.exchangePlanContentSnapshot ?? null);

type PropertyCard =
  | {
      readonly kind: 'section';
      readonly key: string;
      readonly order: number;
      readonly preferredColumn?: 'left' | 'right';
      readonly section: PropertySectionDto;
    }
  | {
      readonly kind: 'subsystems';
      readonly key: string;
      readonly order: number;
      readonly preferredColumn?: 'left' | 'right';
    }
  | {
      readonly kind: 'exchangePlanContent';
      readonly key: string;
      readonly order: number;
      readonly preferredColumn?: 'left' | 'right';
    };

const sectionColumns = computed(() => {
  const cards: PropertyCard[] = sections.value.map((section) => ({
    kind: 'section',
    key: `section:${section.title}`,
    order: section.order,
    preferredColumn: section.title === 'Ввод на основании' || section.title === 'Прочее' ? 'right' : undefined,
    section,
  }));

  if (subsystemSnapshot.value) {
    cards.push({
      kind: 'subsystems',
      key: 'extra:subsystems',
      order: 20,
    });
  }

  if (exchangePlanContentSnapshot.value) {
    cards.push({
      kind: 'exchangePlanContent',
      key: 'extra:exchangePlanContent',
      order: 140,
      preferredColumn: 'right',
    });
  }

  const left: PropertyCard[] = [];
  const right: PropertyCard[] = [];
  [...cards]
    .sort((leftCard, rightCard) => leftCard.order - rightCard.order)
    .forEach((card, index) => {
      if (card.preferredColumn === 'right') {
        right.push(card);
      } else if (card.preferredColumn === 'left' || index % 2 === 0) {
        left.push(card);
      } else {
        right.push(card);
      }
    });

  return { left, right };
});

function hasCards(): boolean {
  return sectionColumns.value.left.length > 0 || sectionColumns.value.right.length > 0;
}

function isTextControl(control: PropertyControl): boolean {
  return control.kind === 'string' || control.kind === 'localizedString';
}

function isEnumControl(control: PropertyControl): boolean {
  return control.kind === 'enum' || control.kind === 'multiEnum';
}

function handleHostMessage(msg: HostToUiMessage): void {
  if (msg.type === 'state') {
    const state = msg.state as Partial<PropertiesViewState>;
    if (state.title !== undefined) title.value = state.title;
    if (state.sections) sections.value = state.sections;
    if (state.readonly !== undefined) readonly.value = state.readonly;
    if (state.readonlyReason !== undefined) readonlyReason.value = state.readonlyReason;
    if (state.diagnostics) diagnostics.value = state.diagnostics;
    if (state.subsystemSnapshot !== undefined) subsystemSnapshot.value = state.subsystemSnapshot;
    if (state.exchangePlanContentSnapshot !== undefined) exchangePlanContentSnapshot.value = state.exchangePlanContentSnapshot;
  }
}

function sendControllerCommand(command: string, payload?: Record<string, unknown>): void {
  props.messageBus.send({ type: 'command', command, payload });
}

function onControlChanged(control: PropertyControl, value: unknown): void {
  if (readonly.value) return;
  sendControllerCommand('propertyChanged', { key: control.id, value });
}

function readonlyText(): string {
  if (readonlyReason.value === 'support') {
    return 'Только чтение: объект на поддержке';
  }
  if (readonlyReason.value === 'repository') {
    return 'Только чтение: объект не захвачен в хранилище';
  }
  return 'Только чтение';
}

onMounted(() => {
  props.messageBus.on('state', handleHostMessage);
});

onUnmounted(() => {
  props.messageBus.off('state', handleHostMessage);
});
</script>

<template>
  <div class="properties-panel">
    <!-- Заголовок -->
    <div class="properties-header">
      <h2 class="properties-title">{{ title }}</h2>
      <span v-if="readonly" class="readonly-badge">{{ readonlyText() }}</span>
    </div>

    <!-- Диагностика -->
    <div v-if="diagnostics.length" class="diagnostics-section">
      <div
        v-for="d in diagnostics"
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

    <!-- Секции свойств -->
    <div v-if="hasCards()" class="sections-list">
      <div class="section-grid">
        <div class="section-column">
          <template v-for="card in sectionColumns.left" :key="card.key">
            <section v-if="card.kind === 'section'" class="property-section">
              <h3 class="section-title">{{ card.section.title }}</h3>
              <PropertyFormsSection
                v-if="card.section.title === 'Формы'"
                :controls="card.section.controls"
                :readonly="readonly"
                @pick="sendControllerCommand('openFormPicker', { key: $event })"
                @clear="sendControllerCommand('clearFormProperty', { key: $event })"
              />
              <div v-else class="section-controls">
                <template v-for="control in card.section.controls" :key="control.id">
                  <PropertyTextControl
                    v-if="isTextControl(control)"
                    :control="control"
                    :readonly="readonly"
                    @change="onControlChanged(control, $event)"
                    @invalid-name="sendControllerCommand('invalidName')"
                  />
                  <PropertyBooleanControl
                    v-else-if="control.kind === 'boolean'"
                    :control="control"
                    :readonly="readonly"
                    @change="onControlChanged(control, $event)"
                  />
                  <PropertyEnumControl
                    v-else-if="isEnumControl(control)"
                    :control="control"
                    :readonly="readonly"
                    @change="onControlChanged(control, $event)"
                  />
                  <PropertyTypeControl
                    v-else-if="control.kind === 'metadataType'"
                    :control="control"
                    :readonly="readonly"
                    @open-picker="sendControllerCommand('openTypePicker', $event)"
                    @update-qualifiers="sendControllerCommand('updateTypeQualifiers', $event)"
                  />
                  <PropertyReferenceListControl
                    v-else-if="control.kind === 'metadataReferenceList'"
                    :control="control"
                    :readonly="readonly"
                    @add="sendControllerCommand('openMetadataReferencePicker', { key: $event })"
                    @remove="sendControllerCommand('removeMetadataReference', $event)"
                  />
                </template>
              </div>
            </section>
            <SubsystemMembershipCard
              v-else-if="card.kind === 'subsystems' && subsystemSnapshot"
              :snapshot="subsystemSnapshot"
              :readonly="readonly"
              @add="sendControllerCommand('openSubsystemMembershipPicker')"
              @remove="sendControllerCommand('removeSubsystemMembership', { value: $event })"
            />
            <ExchangePlanContentCard
              v-else-if="card.kind === 'exchangePlanContent' && exchangePlanContentSnapshot"
              :snapshot="exchangePlanContentSnapshot"
            />
          </template>
        </div>
        <div class="section-column">
          <template v-for="card in sectionColumns.right" :key="card.key">
            <section v-if="card.kind === 'section'" class="property-section">
              <h3 class="section-title">{{ card.section.title }}</h3>
              <PropertyFormsSection
                v-if="card.section.title === 'Формы'"
                :controls="card.section.controls"
                :readonly="readonly"
                @pick="sendControllerCommand('openFormPicker', { key: $event })"
                @clear="sendControllerCommand('clearFormProperty', { key: $event })"
              />
              <div v-else class="section-controls">
                <template v-for="control in card.section.controls" :key="control.id">
                  <PropertyTextControl
                    v-if="isTextControl(control)"
                    :control="control"
                    :readonly="readonly"
                    @change="onControlChanged(control, $event)"
                    @invalid-name="sendControllerCommand('invalidName')"
                  />
                  <PropertyBooleanControl
                    v-else-if="control.kind === 'boolean'"
                    :control="control"
                    :readonly="readonly"
                    @change="onControlChanged(control, $event)"
                  />
                  <PropertyEnumControl
                    v-else-if="isEnumControl(control)"
                    :control="control"
                    :readonly="readonly"
                    @change="onControlChanged(control, $event)"
                  />
                  <PropertyTypeControl
                    v-else-if="control.kind === 'metadataType'"
                    :control="control"
                    :readonly="readonly"
                    @open-picker="sendControllerCommand('openTypePicker', $event)"
                    @update-qualifiers="sendControllerCommand('updateTypeQualifiers', $event)"
                  />
                  <PropertyReferenceListControl
                    v-else-if="control.kind === 'metadataReferenceList'"
                    :control="control"
                    :readonly="readonly"
                    @add="sendControllerCommand('openMetadataReferencePicker', { key: $event })"
                    @remove="sendControllerCommand('removeMetadataReference', $event)"
                  />
                </template>
              </div>
            </section>
            <SubsystemMembershipCard
              v-else-if="card.kind === 'subsystems' && subsystemSnapshot"
              :snapshot="subsystemSnapshot"
              :readonly="readonly"
              @add="sendControllerCommand('openSubsystemMembershipPicker')"
              @remove="sendControllerCommand('removeSubsystemMembership', { value: $event })"
            />
            <ExchangePlanContentCard
              v-else-if="card.kind === 'exchangePlanContent' && exchangePlanContentSnapshot"
              :snapshot="exchangePlanContentSnapshot"
            />
          </template>
        </div>
      </div>
    </div>

    <!-- Пустое состояние -->
    <div v-else class="empty-state">
      <p>Выберите объект метаданных для просмотра свойств</p>
    </div>
  </div>
</template>

<style scoped>
.properties-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  overflow: hidden;
}

.properties-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sidebar-background);
}

.properties-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  padding: 16px;
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
  max-width: 1180px;
  margin: 0 auto;
}

.section-column {
  display: grid;
  gap: 16px;
  align-content: start;
  min-width: 0;
}

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
  z-index: 1;
}

.section-controls {
  display: grid;
  gap: 12px;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  padding: 24px;
}

@media (max-width: 760px) {
  .sections-list {
    padding: 12px;
  }

  .section-grid {
    display: flex;
    flex-direction: column;
  }

  .section-column {
    display: contents;
  }
}
</style>
