<script setup lang="ts">
import type { GraphRowDto, LaneEdgeDto, RefDto } from '@ui-shared/types/history';

const props = defineProps<{
  rows: readonly GraphRowDto[];
  laneCount: number;
  selectedHash?: string;
}>();

const emit = defineEmits<{
  select: [hash: string];
}>();

/** Ширина одной дорожки и высота строки коммита в пикселях. */
const LANE_WIDTH = 14;
const ROW_HEIGHT = 24;
const DOT_RADIUS = 3.5;

/**
 * Стабильная палитра дорожек: контрастные тона, читаемые в тёмной и светлой
 * темах VS Code (не привязаны к `--vscode-*`, т.к. цвет дорожки — семантический
 * идентификатор ветки, а не элемент интерфейса). Индексация — по модулю.
 */
const LANE_PALETTE = [
  '#4e94ce',
  '#e8993a',
  '#4bb85f',
  '#c74e6c',
  '#9b6cc7',
  '#3fb3b3',
  '#c7b23f',
  '#8a8f98',
] as const;

function laneColor(index: number): string {
  const palette = LANE_PALETTE;
  return palette[((index % palette.length) + palette.length) % palette.length] ?? palette[0];
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function svgWidth(): number {
  return Math.max(props.laneCount, 1) * LANE_WIDTH;
}

/** Пилюля ссылки: иконка codicon по виду ссылки (HEAD/ветка/удалённая/тег). */
function refIcon(ref: RefDto): string {
  switch (ref.kind) {
    case 'head':
      return 'target';
    case 'localBranch':
      return 'git-branch';
    case 'remoteBranch':
      return 'cloud';
    case 'tag':
      return 'tag';
    default:
      return 'git-branch';
  }
}

function edgeKey(edge: LaneEdgeDto, index: number): string {
  return `${String(edge.fromLane)}-${String(edge.toLane)}-${String(index)}`;
}

function isSelected(row: GraphRowDto): boolean {
  return row.hash === props.selectedHash;
}
</script>

<template>
  <div class="commit-graph" role="list">
    <div
      v-for="row in props.rows"
      :key="row.hash"
      class="commit-row"
      :class="{ selected: isSelected(row) }"
      role="listitem"
      @click="emit('select', row.hash)"
    >
      <svg
        class="graph-cell"
        :width="svgWidth()"
        :height="ROW_HEIGHT"
        :viewBox="`0 0 ${svgWidth()} ${ROW_HEIGHT}`"
      >
        <line
          v-for="(edge, index) in row.edges"
          :key="edgeKey(edge, index)"
          :x1="laneX(edge.fromLane)"
          :y1="0"
          :x2="laneX(edge.toLane)"
          :y2="ROW_HEIGHT"
          :stroke="laneColor(edge.color)"
          stroke-width="1.5"
          fill="none"
        />
        <circle
          :cx="laneX(row.lane)"
          :cy="ROW_HEIGHT / 2"
          :r="DOT_RADIUS"
          :fill="laneColor(row.laneColor)"
        />
      </svg>

      <span class="commit-subject" :title="row.subject">{{ row.subject }}</span>

      <span class="commit-refs">
        <span
          v-for="ref in row.refs"
          :key="ref.kind + ':' + ref.name"
          class="ref-pill"
          :class="ref.kind"
          :title="ref.name"
        >
          <span class="codicon" :class="`codicon-${refIcon(ref)}`" />
          <span class="ref-name">{{ ref.name }}</span>
        </span>
      </span>

      <span class="commit-author" :title="row.author">{{ row.author }}</span>
      <span class="commit-date" :title="row.absoluteDate">{{ row.relativeDate }}</span>
      <span class="commit-hash">{{ row.shortHash }}</span>
    </div>
    <div v-if="!props.rows.length" class="graph-empty">Нет коммитов</div>
  </div>
</template>

<style scoped>
.commit-graph {
  display: flex;
  flex-direction: column;
}
.commit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0 10px 0 4px;
  cursor: pointer;
  white-space: nowrap;
}
.commit-row:hover {
  background: var(--vscode-list-hoverBackground);
}
.commit-row.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
.graph-cell {
  flex: 0 0 auto;
  overflow: visible;
}
.commit-subject {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.commit-refs {
  flex: 0 0 auto;
  display: inline-flex;
  gap: 4px;
}
.ref-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 160px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 16px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}
.ref-pill .codicon {
  font-size: 11px;
}
.ref-pill .ref-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.ref-pill.head {
  background: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-badge-background));
  color: var(--vscode-editor-background);
}
.ref-pill.tag {
  background: var(--vscode-charts-yellow, var(--vscode-badge-background));
  color: var(--vscode-editor-background);
}
.commit-author {
  flex: 0 0 auto;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.commit-date {
  flex: 0 0 auto;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.commit-hash {
  flex: 0 0 auto;
  font-family: var(--vscode-editor-font-family, monospace);
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.graph-empty {
  padding: 24px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
</style>
