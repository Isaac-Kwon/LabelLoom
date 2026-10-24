import { useEffect } from 'react';
import { m, t, type Msg } from '../i18n';
import type { LabelObject } from '../model/types';
import { act, currentObjects, useStore } from '../store';
import { pickImageInto } from './media';
import { align, copy, duplicate, group, inlineEditable, paste, reorder, selectAll, ungroup } from './ops';
import { editTable } from './TableCanvas';

type Item = { label: Msg; key?: string; run: () => void; disabled?: boolean; title?: Msg } | 'sep';

/**
 * Right-click menu of the editor canvas. On an object it acts on the selection (the click
 * has already selected what was under the pointer); on empty paper it offers paste & view.
 */
export function CanvasMenu({ x, y, at, onEdit, onClose }: {
  x: number; y: number;
  /** where the click landed, in mm — paste goes there */
  at: { x: number; y: number };
  onEdit: (o: LabelObject) => void;
  onClose: () => void;
}) {
  const s = useStore.getState();
  const objects = currentObjects(s);
  const ids = new Set(s.selection);
  const sel = objects.filter((o) => ids.has(o.id));

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  const hasClip = s.clipboard.length > 0 || hasStoredClip();
  const items: Item[] = [];
  if (!sel.length) {
    items.push(
      { label: m('여기에 붙여넣기'), key: 'Ctrl+V', run: () => paste(at), disabled: !hasClip },
      { label: m('모두 선택'), key: 'Ctrl+A', run: selectAll, disabled: !objects.some((o) => !o.locked && !o.hidden) },
      'sep',
      { label: m('화면에 맞추기'), key: 'Ctrl+0', run: () => window.dispatchEvent(new Event('labelloom:fit')) },
      { label: m('폭에 맞추기'), key: 'Ctrl+Shift+0', run: () => window.dispatchEvent(new Event('labelloom:fit-width')) },
    );
  } else {
    const one = sel.length === 1 ? sel[0] : null;
    const allLocked = sel.every((o) => o.locked);
    const n = sel.length;
    const atTop = objects.slice(-n).every((o) => ids.has(o.id));
    const atBottom = objects.slice(0, n).every((o) => ids.has(o.id));
    const grouped = sel.some((o) => o.groupId);

    if (one && !one.locked) {
      if (inlineEditable(one)) items.push({ label: m('내용 편집'), key: 'Enter', run: () => onEdit(one) });
      else if (one.type === 'table') items.push({ label: m('표 칸 편집'), key: 'Enter', run: () => editTable(one) });
      else if (one.type === 'image' || one.type === 'svg') items.push({ label: m('파일 바꾸기…'), run: () => pickImageInto(one.id, one.type as 'image' | 'svg') });
      if (items.length) items.push('sep');
    }
    items.push(
      { label: m('잘라내기'), key: 'Ctrl+X', run: () => copy(true), disabled: allLocked },
      { label: m('복사'), key: 'Ctrl+C', run: () => copy() },
      { label: m('붙여넣기'), key: 'Ctrl+V', run: () => paste(), disabled: !hasClip },
      { label: m('복제'), key: 'Ctrl+D', run: duplicate },
      { label: m('삭제'), key: 'Del', run: act.removeSelected, disabled: allLocked, title: allLocked ? m('잠긴 개체는 지울 수 없습니다') : undefined },
      'sep',
      { label: m('맨 앞으로'), key: 'Ctrl+Shift+]', run: () => reorder('front'), disabled: atTop },
      { label: m('앞으로'), key: 'Ctrl+]', run: () => reorder('forward'), disabled: atTop },
      { label: m('뒤로'), key: 'Ctrl+[', run: () => reorder('backward'), disabled: atBottom },
      { label: m('맨 뒤로'), key: 'Ctrl+Shift+[', run: () => reorder('back'), disabled: atBottom },
    );
    if (n >= 2 || grouped) {
      items.push('sep');
      if (n >= 2) items.push({ label: m('그룹'), key: 'Ctrl+G', run: group });
      if (grouped) items.push({ label: m('그룹 해제'), key: 'Ctrl+Shift+G', run: ungroup });
    }
    const allNoPrint = sel.every((o) => o.noPrint);
    items.push(
      'sep',
      { label: allLocked ? m('잠금 해제') : m('잠금'), run: () => act.update([...ids], { locked: !allLocked }) },
      { label: m('숨기기'), title: m('레이어 목록의 눈 아이콘으로 다시 보이게 할 수 있습니다'), run: () => { act.update([...ids], { hidden: true }); s.select([]); } },
      { label: allNoPrint ? m('인쇄하기') : m('인쇄 안 함 (안내용)'), run: () => act.update([...ids], { noPrint: !allNoPrint }) },
    );
  }

  const run = (it: Exclude<Item, 'sep'>) => { onClose(); it.run(); };
  const showAlign = sel.some((o) => !o.locked);
  const rows = items.filter((it) => it === 'sep').length;
  const h = (items.length - rows) * 27 + rows * 9 + (showAlign ? 40 : 0) + 10;

  return (
    <>
      <div className="ctx-back" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="ctx-menu canvas-menu" role="menu"
        style={{ left: Math.max(4, Math.min(x, window.innerWidth - 240)), top: Math.max(4, Math.min(y, window.innerHeight - h - 4)) }}
        onMouseDown={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
        {showAlign && (
          <>
            <div className="ctx-align" title={sel.length === 1 || new Set(sel.map((o) => o.groupId ?? o.id)).size === 1 ? t('라벨 기준 정렬') : t('선택 영역 기준 정렬')}>
              <button title={t('왼쪽 맞춤')} onClick={() => { onClose(); align('left'); }}>⫷</button>
              <button title={t('가로 가운데')} onClick={() => { onClose(); align('hcenter'); }}>⫿</button>
              <button title={t('오른쪽 맞춤')} onClick={() => { onClose(); align('right'); }}>⫸</button>
              <button title={t('위쪽 맞춤')} onClick={() => { onClose(); align('top'); }}>⊤</button>
              <button title={t('세로 가운데')} onClick={() => { onClose(); align('vcenter'); }}>⊝</button>
              <button title={t('아래쪽 맞춤')} onClick={() => { onClose(); align('bottom'); }}>⊥</button>
            </div>
            <hr />
          </>
        )}
        {items.map((it, i) => it === 'sep'
          ? <hr key={i} />
          : (
            <button key={i} role="menuitem" disabled={it.disabled} title={it.title && t(it.title)} onClick={() => run(it)}>
              <span>{t(it.label)}</span>{it.key && <span className="ctx-key">{it.key}</span>}
            </button>
          ))}
      </div>
    </>
  );
}

function hasStoredClip() {
  try { return (localStorage.getItem('labelloom.clipboard') ?? '[]') !== '[]'; } catch { return false; }
}
