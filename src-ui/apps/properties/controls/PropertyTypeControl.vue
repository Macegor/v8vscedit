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
      <vscode-textfield
        :id="'prop-' + control.id"
        :value="presentation"
        readonly
      />
      <vscode-button
        appearance="secondary"
        :disabled="readonly || control.readonly"
        @click="openPicker"
      >
        Выбрать
      </vscode-button>
    </div>
    <div v-if="control.id === 'Type'" class="qualifiers">
      <template v-if="control.stringQualifiers">
        <label>Длина</label>
        <vscode-textfield
          type="number"
          :value="stringLength"
          :disabled="readonly || control.readonly"
          @input="(e: Event) => { stringLength = (e.target as HTMLInputElement).value; }"
          @change="updateQualifiers"
        />
        <label>Допустимая длина</label>
        <vscode-single-select
          :value="stringAllowedLength"
          :disabled="readonly || control.readonly"
          @change="(e: Event) => { stringAllowedLength = toStringAllowedLength((e.target as HTMLSelectElement).value); updateQualifiers(); }"
        >
          <vscode-option value="Variable">Переменная</vscode-option>
          <vscode-option value="Fixed">Фиксированная</vscode-option>
        </vscode-single-select>
      </template>
      <template v-if="control.numberQualifiers">
        <label>Разрядов</label>
        <vscode-textfield
          type="number"
          :value="numberDigits"
          :disabled="readonly || control.readonly"
          @input="(e: Event) => { numberDigits = (e.target as HTMLInputElement).value; }"
          @change="updateQualifiers"
        />
        <label>Дробных</label>
        <vscode-textfield
          type="number"
          :value="numberFractionDigits"
          :disabled="readonly || control.readonly"
          @input="(e: Event) => { numberFractionDigits = (e.target as HTMLInputElement).value; }"
          @change="updateQualifiers"
        />
        <label>Знак</label>
        <vscode-single-select
          :value="numberAllowedSign"
          :disabled="readonly || control.readonly"
          @change="(e: Event) => { numberAllowedSign = toNumberAllowedSign((e.target as HTMLSelectElement).value); updateQualifiers(); }"
        >
          <vscode-option value="Any">Любой</vscode-option>
          <vscode-option value="Nonnegative">Неотрицательный</vscode-option>
        </vscode-single-select>
      </template>
      <template v-if="control.dateQualifiers">
        <label>Состав даты</label>
        <vscode-single-select
          :value="dateFractions"
          :disabled="readonly || control.readonly"
          @change="(e: Event) => { dateFractions = (e.target as HTMLSelectElement).value; updateQualifiers(); }"
        >
          <vscode-option value="Date">Дата</vscode-option>
          <vscode-option value="DateTime">ДатаВремя</vscode-option>
        </vscode-single-select>
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

vscode-textfield,
vscode-single-select {
  width: 100%;
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
