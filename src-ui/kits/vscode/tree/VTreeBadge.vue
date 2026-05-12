<template>
  <VBadge :variant="badgeVariant" size="sm">{{ label }}</VBadge>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import VBadge from '../primitives/VBadge.vue';

/**
 * Бейдж поддержки/статуса узла дерева.
 * `kind` может быть 'none' | 'editable' | 'locked'.
 */
const props = withDefaults(defineProps<{
  kind?: string;
  label: string;
}>(), {
  kind: '',
  label: '',
});

const badgeVariant = computed(() => {
  switch (props.kind) {
    case 'locked': return 'error';
    case 'editable': return 'info';
    case 'warning': return 'warning';
    default: return 'default';
  }
});
</script>
