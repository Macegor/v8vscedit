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

const presentation = computed(() => props.control.typePresentation ?? (typeof props.control.value === 'string' ? props.control.value : ''));
const isLocked = computed(() => props.readonly || props.control.readonly);
const stringLength = ref(toFieldValue(props.control.stringQualifiers?.length));
const stringAllowedLength = ref(props.control.stringQualifiers?.allowedLength ?? 'Variable');
const numberDigits = ref(toFieldValue(props.control.numberQualifiers?.digits));
const numberFractionDigits = ref(toFieldValue(props.control.numberQualifiers?.fractionDigits));
const numberAllowedSign = ref(props.control.numberQualifiers?.allowedSign ?? 'Any');
const dateFractions = ref(props.control.dateQualifiers?.dateFractions === 'Date' ? 'Date' : 'DateTime');

// Объект `control` приходит заново на каждый state-push, поэтому следим
// за конкретными значениями квалификаторов, а не за ссылкой на объект —
// иначе watch срабатывал бы постоянно и затирал бы текущий ввод пользователя.
// Поле под фокусом не перезаписываем, чтобы не сбрасывать незавершённый ввод.
watch(() => props.control.stringQualifiers?.length, (value) => {
  if (!isFocused('stringLength')) {
    stringLength.value = toFieldValue(value);
  }
});
watch(() => props.control.stringQualifiers?.allowedLength, (value) => {
  stringAllowedLength.value = value ?? 'Variable';
});
watch(() => props.control.numberQualifiers?.digits, (value) => {
  if (!isFocused('numberDigits')) {
    numberDigits.value = toFieldValue(value);
  }
});
watch(() => props.control.numberQualifiers?.fractionDigits, (value) => {
  if (!isFocused('numberFractionDigits')) {
    numberFractionDigits.value = toFieldValue(value);
  }
});
watch(() => props.control.numberQualifiers?.allowedSign, (value) => {
  numberAllowedSign.value = value ?? 'Any';
});
watch(() => props.control.dateQualifiers?.dateFractions, (value) => {
  dateFractions.value = value === 'Date' ? 'Date' : 'DateTime';
});

// Имя поля, которое сейчас редактируется: пока оно в фокусе, входящий
// state-push не должен перетирать локальный ref значением с сервера.
const focusedField = ref<string | null>(null);

function isFocused(field: string): boolean {
  return focusedField.value === field;
}

function onFieldFocus(field: string): void {
  focusedField.value = field;
}

function onFieldBlur(field: string): void {
  if (focusedField.value === field) {
    focusedField.value = null;
  }
}

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
  if (isLocked.value) {
    return;
  }
  emit('openPicker', { key: props.control.id, qualifiers: collectQualifiers() });
}

function updateQualifiers(): void {
  if (isLocked.value || props.control.id !== 'Type') {
    return;
  }
  emit('updateQualifiers', { key: props.control.id, qualifiers: collectQualifiers() });
}
</script>

<template>
  <div class="control-row">
    <label class="control-label" :for="'prop-' + control.id">{{ control.label }}</label>
    <div class="type-picker">
      <input
        :id="'prop-' + control.id"
        class="prop-field type-input"
        type="text"
        :value="presentation"
        readonly
      />
      <div class="type-actions">
        <button
          type="button"
          class="icon-action"
          title="Выбрать тип"
          :disabled="isLocked"
          @click="openPicker"
        >
          <span class="codicon codicon-ellipsis" aria-hidden="true"></span>
        </button>
      </div>
    </div>
    <div v-if="control.id === 'Type'" class="qualifiers">
      <template v-if="control.stringQualifiers">
        <label>Длина</label>
        <input
          class="prop-field"
          type="number"
          :value="stringLength"
          :disabled="readonly || control.readonly"
          @focus="onFieldFocus('stringLength')"
          @blur="onFieldBlur('stringLength')"
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
          @focus="onFieldFocus('numberDigits')"
          @blur="onFieldBlur('numberDigits')"
          @input="(e: Event) => { numberDigits = (e.target as HTMLInputElement).value; }"
          @change="updateQualifiers"
        />
        <label>Дробных</label>
        <input
          class="prop-field"
          type="number"
          :value="numberFractionDigits"
          :disabled="readonly || control.readonly"
          @focus="onFieldFocus('numberFractionDigits')"
          @blur="onFieldBlur('numberFractionDigits')"
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

.type-picker {
  position: relative;
  min-width: 0;
}

.type-input {
  padding-right: 36px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-actions {
  position: absolute;
  top: 50%;
  right: 4px;
  display: inline-flex;
  transform: translateY(-50%);
}

.qualifiers {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  align-items: center;
}

.icon-action {
  width: 24px;
  height: 24px;
  min-width: 24px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 4px;
  color: var(--vscode-icon-foreground, var(--vscode-foreground));
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.icon-action:hover:not(:disabled) {
  background: var(--vscode-list-hoverBackground);
}

.icon-action:disabled {
  opacity: 0.45;
  cursor: default;
}

.property-note {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.4;
}

@media (max-width: 760px) {
  .qualifiers {
    grid-template-columns: 1fr;
  }
}
</style>
