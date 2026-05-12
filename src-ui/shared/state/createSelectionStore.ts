import { ref, computed, type Ref, type ComputedRef } from 'vue';

/** Реактивный store выделения элемента */
export interface SelectionStore<TId extends string = string> {
  readonly selectedId: Ref<TId | null>;
  readonly hasSelection: ComputedRef<boolean>;
  select: (id: TId | null) => void;
  isSelected: (id: TId) => boolean;
  clear: () => void;
}

/** Создать реактивный store выделения */
export function createSelectionStore<TId extends string = string>(): SelectionStore<TId> {
  const selectedId = ref<TId | null>(null);
  const hasSelection = computed(() => selectedId.value !== null);

  return {
    selectedId: selectedId as Ref<TId | null>,
    hasSelection,
    select: (id) => { selectedId.value = id; },
    isSelected: (id) => selectedId.value === id,
    clear: () => { selectedId.value = null; },
  };
}
