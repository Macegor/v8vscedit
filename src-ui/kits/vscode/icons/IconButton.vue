<template>
  <VIconButton
    :disabled="disabled"
    :title="title || ariaLabel"
    :ariaLabel="ariaLabel"
    @click="emit('click', $event)"
  >
    <VscodeIcon :name="name" :size="size" />
  </VIconButton>
</template>

<script setup lang="ts">
import VIconButton from '../primitives/VIconButton.vue';
import VscodeIcon from './VscodeIcon.vue';

/**
 * Кнопка с иконкой codicon. Обёртка над VIconButton + VscodeIcon.
 */
withDefaults(defineProps<{
  name: string;
  title?: string;
  ariaLabel: string;
  disabled?: boolean;
  size?: number;
}>(), {
  disabled: false,
  size: 16,
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>
