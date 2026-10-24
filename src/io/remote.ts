import { useEffect } from 'react';
import { t } from '../i18n';
import { useStore } from '../store';
import { absorbMeta, fetchTable, gridToRows, isMetaColumn, syncTable } from './table';

/** Fetch the project's data source again and merge it into the table. */
export async function refreshSource(manual = false) {
  const s = useStore.getState();
  const src = s.project.dataSource;
  if (!src || s.sync.busy) return;
  s.setSync({ busy: true });
  try {
    const parsed = await fetchTable(src.url, src.sheet);
    const got = gridToRows(parsed.grid, src);
    const add = { columns: got.columns.filter((c) => !isMetaColumn(c)), rows: absorbMeta(got.rows) };
    let added = 0, updated = 0;
    useStore.getState().commit((p) => {
      if (p.dataSource?.url !== src.url) return p; // disconnected or replaced while fetching
      const r = syncTable(p.data, add, src.key, !!src.copiesColumn);
      added = r.added;
      updated = r.updated;
      return r.table === p.data ? p : { ...p, data: r.table };
    });
    const st = useStore.getState();
    st.setSync({ busy: false, at: new Date().toISOString(), error: undefined });
    if (added || updated) st.notify(t('URL 데이터: {added}행 추가, {updated}행 갱신', { added, updated }));
    else if (manual) st.notify(t('URL 데이터: 바뀐 내용이 없습니다.'));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    useStore.getState().setSync({ busy: false, error });
    if (manual) useStore.getState().notify(error);
  }
}

/** Refresh the data source on its interval while the page is visible. */
export function useRemoteSync(enabled: boolean) {
  const url = useStore((s) => s.project.dataSource?.url);
  const interval = useStore((s) => s.project.dataSource?.interval ?? 0);
  useEffect(() => {
    if (!enabled || !url || !interval) return;
    void refreshSource();
    const id = window.setInterval(() => { if (!document.hidden) void refreshSource(); }, interval * 1000);
    return () => window.clearInterval(id);
  }, [enabled, url, interval]);
}
