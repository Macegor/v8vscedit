<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PropertyControl } from '@ui-shared/types/property';

const props = defineProps<{
  control: PropertyControl;
  readonly: boolean;
}>();

const emit = defineEmits<{
  openPicker: [payload: { key: string; qualifiers: Record<string, string> }];
  updateQualifiers: [payload: { key: string; qualifiers: Record<string, string> }];
}>();

const presentation = computed(() => props.control.typePresentation || String(props.control.value ?? ''));
const stringLength = ref(toFieldValue(props.control.stringQualifiers?.length));
const stringAllowedLength = ref(props.control.stringQualifiers?.allowedLength ?? 'Variable');
const numberDigits = ref(toFieldValue(props.control.numberQualifiers?.digits));
const numberFractionDigits = ref(toFieldValue(props.control.numberQualifiers?.fractionDigits));
const numberAllowedSign = ref(props.control.numberQualifiers?.allowedSign ?? 'Any');
const dateFractions = ref(props.control.dateQualifiers?.dateFractions === 'Date' ? 'Date' : 'DateTime');

watch(() => props.control, () => {
  stringLength.value = toFieldValue(props.control.stringQualifiers?.length);
  stringAllowedLength.value = props.control.stringQualifiers?.allowedLength ?? 'Variable';
  numberDigits.value = toFieldValue(props.control.numberQualifiers?.digits);
  numberFractionDigits.value = toFieldValue(props.control.numberQualifiers?.fractionDigits);
  numberAllowedSign.value = props.control.numberQualifiers?.allowedSign ?? 'Any';
  dateFractions.value = props.control.dateQualifiers?.dateFractions === 'Date' ? 'Date' : 'DateTime';
});

function toFieldValue(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function toStringAllowedLength(value: string): 'Variable' | 'Fixed' {
  return value === 'Fixed' ? 'Fixed' : 'Variable';
}

function toNumberAllowedSign(value: string): 'Any' | 'Nonnegative' {
  return value === 'Nonnegative' ? 'Nonnegative' : 'Any';
}

function collectQualifiers(): Record<string, string> {
  return {
    stringLength: stringLength.value,
    stringAllowedLength: stringAllowedLength.value,
    numberDigits: numberDigits.value,
    numberFractionDigits: numberFractionDigits.value,
    numberAllowedSign: numberAllowedSign.value,
    dateFractions: dateFractions.value,
  };
}

function openPicker(): void {
  if (props.readonly || props.control.readonly) {
    return;
  }
  emit('openPicker', { key: props.control.id, qualifiers: collectQualifiers() });
}

function updateQualifiers(): void {
  if (props.readonly || props.control.readonly || props.control.id !== 'Type') {
    return;
  }
  emit('updateQualifiers', { key: props.control.id, qualifiers: collectQualifiers() });
}
</script>

<template>
  <div class="control-row">
    <label class="control-label" :for="'prop-' + control.id">{{ control.label }}</label>
    <div class="type-row">
      <input
        :id="'prop-' + control.id"
        class="prop-field"
        type="text"
        :value="presentation"
        readonly
      />
      <button
        type="button"
        class="type-pick-button"
        :disabled="readonly || control.readonly"
        @click="openPicker"
      >
        Выбрать
      </button>
    </div>
    <div v-if="control.id === 'Type'" class="qualifiers">
      <template v-if="control.stringQualifiers">
        <label>Длина</label>
        <input
          class="prop-field"
          type="number"
          :value="stringLength"
          :disabled="readonly || control.readonly"
          @input="(e: Event) => { stringLength = (e.target as HTMLInputElement).value; }"
          @change="updateQualifiers"
        />
        <label>Допустимая длина</label>
        <select
          class="prop-select"
          :value="stringAllowedLength"
          :disabled="readonly || control.readonly"
          @change="(e: Event) => { stringAllowedLength = toStringAllowedLength((e.target as HTMLSelectElement).value); updateQualifiers(); }"
        >
          <option value="Variable">Переменная</option>
          <option value="Fixed">Фиксированная</option>
        </select>
      </template>
      <template v-if="control.numberQualifiers">
        <label>Разрядов</label>
        <input
          class="prop-field"
          type="number"
          :value="numberDigits"
          :disabled="readonly || control.readonly"
          @input="(e: Event) => { numberDigits = (e.target as HTMLInputElement).value; }"
          @change="updateQualifiers"
        />
        <label>Дробных</label>
        <input
          class="prop-field"
          type="number"
          :value="numberFractionDigits"
          :disabled="readonly || control.readonly"
          @input="(e: Event) => { numberFractionDigits = (e.target as HTMLInputElement).value; }"
          @change="updateQualifiers"
        />
        <label>Знак</label>
        <select
          class="prop-select"
          :value="numberAllowedSign"
          :disabled="readonly || control.readonly"
          @change="(e: Event) => { numberAllowedSign = toNumberAllowedSign((e.target as HTMLSelectElement).value); updateQualifiers(); }"
        >
          <option value="Any">Любой</option>
          <option value="Nonnegative">Неотрицательный</option>
        </select>
      </template>
      <template v-if="control.dateQualifiers">
        <label>Состав даты</label>
        <select
          class="prop-select"
          :value="dateFractions"
          :disabled="readonly || control.readonly"
          @change="(e: Event) => { dateFractions = (e.target as HTMLSelectElement).value; updateQualifiers(); }"
        >
          <option value="Date">Дата</option>
          <option value="DateTime">ДатаВремя</option>
        </select>
      </template>
    </div>
    <div v-if="control.inherited" class="property-note">
      Значение из основной конфигурации. Переопределение через панель свойств пока недоступно.
    </div>
    <div v-else-if="control.readonly" class="property-note">Служебное свойство доступно только для чтения.</div>
  </div>
</template>

<style scoped>
.control-row {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.control-label,
.qualifiers label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.type-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.qualifiers {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  align-items: center;
}

.type-pick-button {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 5px;
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.type-pick-button:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground);
}

.type-pick-button:disabled {
  opacity: 0.55;
  cursor: default;
}

.property-note {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.4;
}

@media (max-width: 760px) {
  .type-row,
  .qualifiers {
    grid-template-columns: 1fr;
  }
}
</style>
