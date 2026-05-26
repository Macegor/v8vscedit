<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  ActiveDocumentInfo,
  ModuleSymbolDto,
  ModuleSymbolKind,
  RangeDto,
} from '@ui-shared/types/dynamicPanel';

const props = defineProps<{
  document: ActiveDocumentInfo;
  symbols: ModuleSymbolDto[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  reveal: [range: RangeDto];
}>();

const filter = ref('');

interface FlatNode {
  readonly path: string;
  readonly symbol: ModuleSymbolDto;
  readonly depth: number;
  readonly hasChildren: boolean;
}

const collapsed = ref<Set<string>>(new Set());

function pathOf(parentPath: string, index: number): string {
  return parentPath ? `${parentPath}/${index}` : String(index);
}

function flatten(symbols: ModuleSymbolDto[], depth: number, parentPath: string, output: FlatNode[]): void {
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const path = pathOf(parentPath, i);
    const hasChildren = symbol.children.length > 0;
    output.push({ path, symbol, depth, hasChildren });
    if (hasChildren && !collapsed.value.has(path)) {
      flatten(symbol.children, depth + 1, path, output);
    }
  }
}

function matchesFilter(symbol: ModuleSymbolDto, q: string): boolean {
  if (!q) return true;
  if (symbol.name.toLowerCase().includes(q)) return true;
  return symbol.children.some((child) => matchesFilter(child, q));
}

function filterTree(items: ModuleSymbolDto[], q: string): ModuleSymbolDto[] {
  if (!q) return items;
  return items
    .filter((item) => matchesFilter(item, q))
    .map((item) => ({
      ...item,
      children: filterTree(item.children, q),
    }));
}

const visibleSymbols = computed(() => filterTree(props.symbols, filter.value.trim().toLowerCase()));

const flatList = computed<FlatNode[]>(() => {
  const output: FlatNode[] = [];
  flatten(visibleSymbols.value, 0, '', output);
  return output;
});

const baseFileName = computed(() => {
  const parts = props.document.fileName.split(/[\\/]/);
  return parts[parts.length - 1] || props.document.fileName;
});

function toggle(path: string): void {
  if (collapsed.value.has(path)) {
    collapsed.value.delete(path);
  } else {
    collapsed.value.add(path);
  }
  collapsed.value = new Set(collapsed.value);
}

function reveal(symbol: ModuleSymbolDto): void {
  emit('reveal', symbol.selectionRange ?? symbol.range);
}

function iconClass(kind: ModuleSymbolKind): string {
  switch (kind) {
    case 'function':
      return 'codicon codicon-symbol-function';
    case 'method':
      return 'codicon codicon-symbol-method';
    case 'variable':
      return 'codicon codicon-symbol-variable';
    case 'constant':
      return 'codicon codicon-symbol-constant';
    case 'namespace':
      return 'codicon codicon-symbol-namespace';
    case 'property':
      return 'codicon codicon-symbol-property';
    case 'field':
      return 'codicon codicon-symbol-field';
    default:
      return 'codicon codicon-symbol-misc';
  }
}
</script>

<template>
  <div class="module-structure">
    <header class="module-header">
      <span class="module-title" :title="document.fileName">{{ baseFileName }}</span>
      <span v-if="loading" class="module-loading" aria-label="Загрузка">…</span>
    </header>

    <div class="module-filter">
      <vscode-textfield
        :value="filter"
        placeholder="Найти символ"
        @input="(e: Event) => (filter = (e.target as HTMLInputElement).value)"
      />
    </div>

    <div v-if="flatList.length === 0" class="module-empty">
      <p>{{ loading ? 'Анализ модуля…' : 'Структура модуля пуста.' }}</p>
    </div>
    <ul v-else class="module-list" role="tree">
      <li
        v-for="node in flatList"
        :key="node.path"
        class="module-row"
        :style="{ paddingLeft: 4 + node.depth * 12 + 'px' }"
        role="treeitem"
        :aria-level="node.depth + 1"
        :aria-expanded="node.hasChildren ? !collapsed.has(node.path) : undefined"
        tabindex="0"
        @click="reveal(node.symbol)"
        @keydown.enter.prevent="reveal(node.symbol)"
        @keydown.space.prevent="reveal(node.symbol)"
      >
        <button
          v-if="node.hasChildren"
          type="button"
          class="module-chevron"
          :class="{ 'module-chevron--collapsed': collapsed.has(node.path) }"
          aria-label="Развернуть/свернуть"
          @click.stop="toggle(node.path)"
        >
          <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
        </button>
        <span v-else class="module-chevron module-chevron--placeholder" aria-hidden="true"></span>
        <span class="module-icon" :class="iconClass(node.symbol.kind)" aria-hidden="true"></span>
        <span class="module-name">{{ node.symbol.name }}</span>
        <span v-if="node.symbol.detail" class="module-detail">{{ node.symbol.detail }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.module-structure {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.module-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.module-title {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
}

.module-loading {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.module-filter {
  padding: 6px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.module-filter vscode-textfield {
  width: 100%;
}

.module-empty {
  padding: 12px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.module-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
}

.module-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 0;
  cursor: pointer;
  font-size: 13px;
  line-height: 22px;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
}

.module-row:hover {
  background: var(--vscode-list-hoverBackground);
}

.module-row:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
  background: var(--vscode-list-focusBackground);
}

.module-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--vscode-icon-foreground);
  cursor: pointer;
  padding: 0;
  font: inherit;
}

.module-chevron:hover {
  color: var(--vscode-foreground);
}

.module-chevron--collapsed .codicon-chevron-down {
  transform: rotate(-90deg);
}

.module-chevron--placeholder {
  cursor: default;
}

.module-icon {
  display: inline-flex;
  align-items: center;
  width: 16px;
  height: 16px;
  color: var(--vscode-symbolIcon-functionForeground, var(--vscode-icon-foreground));
}

.module-icon.codicon-symbol-method {
  color: var(--vscode-symbolIcon-methodForeground, var(--vscode-icon-foreground));
}

.module-icon.codicon-symbol-variable {
  color: var(--vscode-symbolIcon-variableForeground, var(--vscode-icon-foreground));
}

.module-icon.codicon-symbol-namespace {
  color: var(--vscode-symbolIcon-namespaceForeground, var(--vscode-icon-foreground));
}

.module-name {
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-detail {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}
</style>
