import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useSelectionStore = defineStore('selection', () => {
  const selectedIds = ref<Set<string>>(new Set());

  const selectedPlantId = computed<string | null>(() => {
    const ids = [...selectedIds.value];
    return ids.length === 1 ? ids[0] : ids.length > 1 ? ids[0] : null;
  });

  function selectPlant(id: string): void {
    selectedIds.value = new Set([id]);
  }

  function togglePlant(id: string): void {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
  }

  function selectMany(ids: string[]): void {
    selectedIds.value = new Set(ids);
  }

  function clearSelection(): void {
    selectedIds.value = new Set();
  }

  return { selectedIds, selectedPlantId, selectPlant, togglePlant, selectMany, clearSelection };
});
