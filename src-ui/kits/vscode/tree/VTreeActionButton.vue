<template>
  <VIconButton
    :ariaLabel="action.label"
    :title="action.label"
    :disabled="action.enabled === false"
    @click="emit('click', $event)"
  >
    <VTreeIcon v-if="action.icon" :icon="action.icon" />
    <span v-else>{{ action.label[0] }}</span>
  </VIconButton>
</template>

<script setup lang="ts">
import type { TreeNodeActionDto } from '@ui-shared/types/tree';
import VIconButton from '../primitives/VIconButton.vue';
import VTreeIcon from './VTreeIcon.vue';

/**
 * Кнопка действия узла дерева. Отображается в VTreeActions
 * при наведении на строку.
 */
defineProps<{
  action: TreeNodeActionDto;
}>();

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>
