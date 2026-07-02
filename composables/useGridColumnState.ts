import type { GridApi } from 'ag-grid-community';
import type { Preferences } from '~/types/preferences';

/**
 * AG Grid 列状态（哪些列显示、宽度、顺序、pinned、sort 等）的持久化。
 * 存在 preferences.gridColumnState[pageKey]，随 preferences 一起同步到 KV，
 * 从而实现多设备一致的列布局。
 *
 * 用法：
 *   const { save, restore } = useGridColumnState('article');
 *   onGridReady(...) { save; restore(gridApi); }
 *   @column-moved="save(gridApi)"
 */
export default function useGridColumnState(pageKey: string) {
  const preferences = usePreferences() as unknown as Ref<Preferences>;

  function save(gridApi: GridApi | null) {
    if (!gridApi) return;
    const state = gridApi.getColumnState();
    if (!preferences.value.gridColumnState) {
      preferences.value.gridColumnState = {};
    }
    preferences.value.gridColumnState[pageKey] = state;
  }

  function restore(gridApi: GridApi | null) {
    if (!gridApi) return;
    const state = preferences.value.gridColumnState?.[pageKey];
    if (state) {
      try {
        gridApi.applyColumnState({ state: state as any[], applyOrder: true });
      } catch {
        // 版本升级导致的 state 结构不兼容时静默忽略
      }
    }
  }

  return { save, restore };
}
