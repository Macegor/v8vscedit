<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  ActiveDocumentInfo,
  ModuleSymbolDto,
  ModuleSymbolKind,
  RangeDto,
} from '@ui-shared/types/dynamicPanel';
import type { TreeNodeDto } from '@ui-shared/types/tree';
import type { IconDto } from '@ui-shared/types/icon';
import UniversalTree from '../../universal/UniversalTree.vue';

const props = defineProps<{
  document: ActiveDocumentInfo;
  symbols: ModuleSymbolDto[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  reveal: [range: RangeDto];
}>();

const filter = ref('');
/** Явно свёрнутые узлы (по умолчанию всё дерево раскрыто). */
const collapsedIds = ref<Record<string, true>>({});
const selectedId = ref<string | null>(null);

function pathOf(parentPath: string, index: number): string {
  return parentPath ? `${parentPath}/${String(index)}` : String(index);
}

function iconForKind(kind: ModuleSymbolKind): IconDto {
  switch (kind) {
    case 'function':
      return { kind: 'codicon', name: 'symbol-function' };
    case 'method':
      return { kind: 'codicon', name: 'symbol-method' };
    case 'variable':
      return { kind: 'codicon', name: 'symbol-variable' };
    case 'constant':
      return { kind: 'codicon', name: 'symbol-constant' };
    case 'namespace':
      return { kind: 'codicon', name: 'symbol-namespace' };
    case 'property':
      return { kind: 'codicon', name: 'symbol-property' };
    case 'field':
      return { kind: 'codicon', name: 'symbol-field' };
    default:
      return { kind: 'codicon', name: 'symbol-misc' };
  }
}

function matchesFilter(symbol: ModuleSymbolDto, q: string): boolean {
  if (!q) return true;
  if (symbol.name.toLowerCase().includes(q)) return true;
  return symbol.children.some((child) => matchesFilter(child, q));
}

function buildNode(
  symbol: ModuleSymbolDto,
  parentPath: string,
  index: number,
  q: string,
  outIndex: Map<string, ModuleSymbolDto>
): TreeNodeDto | null {
  if (q && !matchesFilter(symbol, q)) {
    return null;
  }
  const id = pathOf(parentPath, index);
  outIndex.set(id, symbol);

  const children: TreeNodeDto[] = [];
  for (let i = 0; i < symbol.children.length; i++) {
    const child = buildNode(symbol.children[i], id, i, q, outIndex);
    if (child) {
      children.push(child);
    }
  }

  const tooltip = symbol.documentation
    ? `${symbol.name}${symbol.detail ? ` ${symbol.detail}` : ''}\n\n${symbol.documentation}`
    : undefined;

  return {
    id,
    key: id,
    label: symbol.name,
    description: symbol.detail,
    tooltip,
    icon: iconForKind(symbol.kind),
    kind: symbol.kind,
    hasChildren: children.length > 0,
    loaded: true,
    children,
    actions: [],
  };
}

interface TreeData {
  readonly nodes: TreeNodeDto[];
  readonly index: Map<string, ModuleSymbolDto>;
}

const treeData = computed<TreeData>(() => {
  const index = new Map<string, ModuleSymbolDto>();
  const q = filter.value.trim().toLowerCase();
  const nodes: TreeNodeDto[] = [];
  for (let i = 0; i < props.symbols.length; i++) {
    const node = buildNode(props.symbols[i], '', i, q, index);
    if (node) {
      nodes.push(node);
    }
  }
  return { nodes, index };
});

const treeNodes = computed<TreeNodeDto[]>(() => treeData.value.nodes);

/** Все id с раскрытым состоянием. По умолчанию открыто всё, что НЕ в collapsedIds. */
const openIds = computed<Record<string, true>>(() => {
  const ids: Record<string, true> = {};
  const visit = (nodes: readonly TreeNodeDto[]): void => {
    for (const node of nodes) {
      if (node.hasChildren && !collapsedIds.value[node.id]) {
        ids[node.id] = true;
      }
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(treeNodes.value);
  return ids;
});

// При смене документа сбрасываем явные сворачивания — новый модуль показываем полностью раскрытым.
watch(() => props.document.uri, () => {
  collapsedIds.value = {};
});

const baseFileName = computed(() => {
  const parts = props.document.fileName.split(/[\\/]/);
  return parts[parts.length - 1] || props.document.fileName;
});

function onToggle(nodeId: string, open: boolean): void {
  const next = { ...collapsedIds.value };
  if (open) {
    delete next[nodeId];
  } else {
    next[nodeId] = true;
  }
  collapsedIds.value = next;
}

function onSelect(nodeId: string | null): void {
  selectedId.value = nodeId;
  if (!nodeId) {
    return;
  }
  const symbol = treeData.value.index.get(nodeId);
  if (!symbol) {
    return;
  }
  emit('reveal', symbol.selectionRange ?? symbol.range);
}

function onDefault(nodeId: string): void {
  onSelect(nodeId);
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

    <div v-if="treeNodes.length === 0" class="module-empty">
      <p>{{ loading ? 'Анализ модуля…' : 'Структура модуля пуста.' }}</p>
    </div>
    <UniversalTree
      v-else
      :nodes="treeNodes"
      :selected-id="selectedId"
      :open-ids="openIds"
      :loading-ids="{}"
      @toggle="onToggle"
      @select="onSelect"
      @default="onDefault"
    />
  </div>
</template>

<style scoped>
.module-structure {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.module-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.module-title {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-foreground);
}

.module-loading {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.module-filter {
  padding: 4px 0;
}

.module-filter vscode-textfield {
  width: 100%;
}

.module-empty {
  padding: 6px 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
</style>
