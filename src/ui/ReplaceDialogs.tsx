import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { suggestMapping } from '../io/table';
import type { LabelObject, Project } from '../model/types';
import { renameColumnInDesigns, usedColumns } from '../render/resolve';
import { useStore } from '../store';
import { Check, Modal, Row, Select } from './controls';

/* ---------- find & replace ---------- */

interface Find { text: string; caseSensitive: boolean; keepFields: boolean; wholeCell: boolean }

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces in a design text; with keepFields the {{…}} parts are left alone. Returns the text and the count. */
function replaceIn(s: string, f: Find, to: string): [string, number] {
  if (!f.text || !s) return [s, 0];
  const re = new RegExp(escRe(f.text), f.caseSensitive ? 'g' : 'gi');
  let n = 0;
  const swap = (part: string) => part.replace(re, () => { n++; return to; });
  const out = f.keepFields ? s.split(/(\{\{[^{}]*\}\})/).map((part, i) => (i % 2 ? part : swap(part))).join('') : swap(s);
  return [out, n];
}

function replaceDesigns(p: Project, f: Find, to: string): [Project, number] {
  let n = 0;
  const r = (s: string) => { const [x, k] = replaceIn(s, f, to); n += k; return x; };
  const fix = (o: LabelObject): LabelObject => {
    let x = { ...o, rules: o.rules.map((rule) => (rule.set.text ? { ...rule, set: { ...rule.set, text: r(rule.set.text) } } : rule)) } as LabelObject;
    // an image's content names a picture file, not text on the label
    if ('content' in x && x.type !== 'image') x = { ...x, content: r(x.content) } as LabelObject;
    if (x.type === 'table') x = { ...x, cells: x.cells.map((row) => row.map(r)) };
    return x;
  };
  const designs = p.designs.map((d) => ({ ...d, objects: d.objects.map(fix), back: d.back?.map(fix) }));
  return [n ? { ...p, designs } : p, n];
}

function replaceData(p: Project, f: Find, to: string, column: string): [Project, number] {
  if (!f.text) return [p, 0];
  let n = 0;
  const same = (a: string) => (f.caseSensitive ? a === f.text : a.toLowerCase() === f.text.toLowerCase());
  const re = new RegExp(escRe(f.text), f.caseSensitive ? 'g' : 'gi');
  const rows = p.data.rows.map((row) => {
    let changed = false;
    const values = { ...row.values };
    for (const c of column ? [column] : p.data.columns) {
      const v = values[c] ?? '';
      let next = v;
      if (f.wholeCell) { if (same(v.trim())) { next = to; n++; } }
      else next = v.replace(re, () => { n++; return to; });
      if (next !== v) { values[c] = next; changed = true; }
    }
    return changed ? { ...row, values } : row;
  });
  return [n ? { ...p, data: { ...p.data, rows } } : p, n];
}

export function ReplaceDialog() {
  const project = useStore((s) => s.project);
  const { close, commit, notify } = useStore.getState();
  const [f, setF] = useState<Find>({ text: '', caseSensitive: false, keepFields: true, wholeCell: false });
  const [to, setTo] = useState('');
  const [where, setWhere] = useState<'design' | 'data'>('design');
  const [column, setColumn] = useState('');
  const run = (p: Project): [Project, number] => (where === 'design' ? replaceDesigns(p, f, to) : replaceData(p, f, to, column));
  const count = useMemo(() => run(project)[1], [project, f, to, where, column]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = () => {
    if (!count) return;
    commit((p) => run(p)[0]);
    notify(t('{n}곳을 바꿨습니다.', { n: count }));
    close();
  };
  return (
    <Modal title={t('찾아 바꾸기')} onClose={close} footer={<>
      <span className="muted small">{f.text ? t('{n}곳 찾음', { n: count }) : ''}</span>
      <span className="spacer" /><button onClick={close}>{t('취소')}</button>
      <button className="primary" disabled={!count} onClick={apply}>{t('모두 바꾸기')}</button>
    </>}>
      <Row label={t('대상')}>
        <Select value={where} onChange={setWhere} options={[
          { value: 'design', label: t('디자인 문구 (모든 디자인·앞뒷면·표·조건부 문구)') },
          { value: 'data', label: t('데이터 값') },
        ]} />
      </Row>
      {where === 'data' && (
        <Row label={t('열')}>
          <Select value={column} onChange={setColumn} options={[{ value: '', label: t('모든 열') }, ...project.data.columns.map((c) => ({ value: c, label: c }))]} />
        </Row>
      )}
      <Row label={t('찾을 말')}><input autoFocus value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && apply()} /></Row>
      <Row label={t('바꿀 말')}><input value={to} onChange={(e) => setTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} placeholder={t('(비우면 지움)')} /></Row>
      <Check label={t('대소문자 구분')} checked={f.caseSensitive} onChange={(v) => setF({ ...f, caseSensitive: v })} />
      {where === 'design'
        ? <Check label={t('{{열 이름}} 안은 바꾸지 않음')} checked={f.keepFields} onChange={(v) => setF({ ...f, keepFields: v })} title={t('데이터 연결이 끊기지 않게 합니다. 열 이름을 바꾸려면 열 다시 연결을 쓰세요.')} />
        : <Check label={t('셀 값 전체가 같을 때만')} checked={f.wholeCell} onChange={(v) => setF({ ...f, wholeCell: v })} />}
    </Modal>
  );
}

/* ---------- re-link columns ---------- */

/** Columns the designs read that the data does not have. */
export const missingColumns = (p: Project) => (p.data.columns.length ? usedColumns(p).filter((c) => !p.data.columns.includes(c)) : []);

export function RemapDialog() {
  const project = useStore((s) => s.project);
  const { close, commit, notify } = useStore.getState();
  const used = useMemo(() => usedColumns(project), [project]);
  const missing = used.filter((c) => !project.data.columns.includes(c));
  // every column the designs read can be pointed elsewhere; the missing ones come first with a guess
  const [map, setMap] = useState<Record<string, string>>(() => {
    const guess = suggestMapping(missing, project.data.columns);
    return Object.fromEntries(missing.map((c) => [c, project.data.columns.includes(guess[c]) ? guess[c] : '']));
  });
  const list = [...missing, ...used.filter((c) => !missing.includes(c))];
  const changes = Object.entries(map).filter(([from, to]) => to && to !== from);
  const apply = () => {
    commit((p) => changes.reduce((q, [from, to]) => renameColumnInDesigns(q, from, to), p));
    notify(t('열 {n}개를 다시 연결했습니다.', { n: changes.length }));
    close();
  };
  return (
    <Modal title={t('열 다시 연결')} onClose={close} wide footer={<>
      <span className="spacer" /><button onClick={close}>{t('취소')}</button>
      <button className="primary" disabled={!changes.length} onClick={apply}>{t('적용 ({n})', { n: changes.length })}</button>
    </>}>
      <p className="muted">{t('디자인이 읽는 {{열 이름}}을 지금 데이터의 열로 바꿉니다. 열 이름이 다른 명단을 가져왔을 때 쓰세요. 데이터는 그대로입니다.')}</p>
      {!list.length && <p className="muted">{t('디자인에 연결된 열이 없습니다.')}</p>}
      <table className="remap">
        <tbody>
          {list.map((c) => (
            <tr key={c} className={missing.includes(c) ? 'missing' : ''}>
              <td><code>{`{{${c}}}`}</code>{missing.includes(c) && <span className="warn-inline small"> {t('데이터에 없음')}</span>}</td>
              <td>→</td>
              <td>
                <Select value={map[c] ?? ''} onChange={(v) => setMap({ ...map, [c]: v })}
                  options={[{ value: '', label: missing.includes(c) ? t('(연결 안 함)') : t('(그대로)') }, ...project.data.columns.filter((x) => x !== c).map((x) => ({ value: x, label: x }))]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
