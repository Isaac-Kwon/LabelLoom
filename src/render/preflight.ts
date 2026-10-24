import { m, t, type Msg } from '../i18n';
import type { LabelObject, Project } from '../model/types';
import { barcodeSvg, code2dSvg } from './barcode';
import { objectPicture } from './images';
import type { JobItem } from './jobs';
import { resolveObject, templateColumns, type ResolveCtx } from './resolve';
import { plainText } from './rich';
import { textLayout } from './svg';

/** Checks before printing: what would come out wrong on which label, so it can be fixed first. */

export type IssueKind = 'code' | 'overflow' | 'truncated' | 'empty' | 'picture' | 'webPicture';

export const ISSUE_LABEL: Record<IssueKind, Msg> = {
  code: m('코드 오류 (빈칸으로 출력)'),
  overflow: m('글자가 상자를 넘침'),
  truncated: m('말줄임(…)으로 잘림'),
  empty: m('연결한 값이 비어 있음'),
  picture: m('사진 없음'),
  webPicture: m('웹 사진을 받지 못함 (PDF·PNG에서 빠짐)'),
};

export interface Issue {
  kind: IssueKind;
  rowIndex: number;
  designId: string;
  side: 'front' | 'back';
  objId: string;
  objName: string;
  detail: string;
}

export interface Preflight { issues: Issue[]; counts: Partial<Record<IssueKind, number>>; total: number }

/** Each data row (or the blank label) once, front and, with `back`, back side. `max` caps the listed issues, not the counts. */
export function preflight(p: Project, items: JobItem[], o: { back: boolean; max?: number }): Preflight {
  const max = o.max ?? 200;
  const issues: Issue[] = [];
  const counts: Partial<Record<IssueKind, number>> = {};
  let total = 0;
  const seen = new Set<string>();
  const now = new Date();
  const report = (kind: IssueKind, it: JobItem, side: Issue['side'], obj: LabelObject, detail: string) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    total++;
    if (issues.length < max) issues.push({ kind, rowIndex: it.rowIndex, designId: it.design.id, side, objId: obj.id, objName: obj.name, detail });
  };
  for (const it of items) {
    if (it.separator !== undefined) continue;
    const key = `${it.row?.id ?? it.rowIndex}|${it.design.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ctx: ResolveCtx = { row: it.row, rowIndex: it.rowIndex, seq: it.seq, copy: 1, page: 1, now };
    const sides: [Issue['side'], LabelObject[]][] = [['front', it.design.objects]];
    if (o.back && it.design.back?.length) sides.push(['back', it.design.back]);
    for (const [side, objects] of sides) {
      for (const src of objects) {
        if (src.hidden || src.noPrint) continue;
        const r = resolveObject(src, ctx);
        if (r.hidden) continue;
        const obj = r.obj;
        // a bound value that is empty, on an object that does not hide itself
        if ('content' in src && it.row) {
          // only when the object comes out blank: optional parts of a longer text are fine
          const cols = templateColumns(src.content).filter((c) => !(it.row!.values[c] ?? '').trim());
          const text = obj.type === 'text' ? plainText(r.content) : r.content;
          if (cols.length && !text.trim()) report('empty', it, side, src, cols.join(', '));
        }
        if (obj.type === 'text' && plainText(r.content)) {
          const { L } = textLayout(obj, r.content);
          if (L.overflow) report('overflow', it, side, src, plainText(r.content).replace(/\s+/g, ' ').slice(0, 40));
          else if (L.truncated) report('truncated', it, side, src, plainText(r.content).replace(/\s+/g, ' ').slice(0, 40));
        } else if ((obj.type === 'barcode' || obj.type === 'qr') && r.content) {
          const res = obj.type === 'barcode' ? barcodeSvg(obj, r.content) : code2dSvg(obj, r.content);
          if ('error' in res) report('code', it, side, src, res.error);
        } else if (obj.type === 'image') {
          const pic = objectPicture(obj, r.content, p.images);
          if ('missing' in pic) report('picture', it, side, src, pic.missing);
          else if (pic.failed) report('webPicture', it, side, src, (obj.content.trim() ? r.content : obj.src).trim());
        }
      }
    }
  }
  return { issues, counts, total };
}

/** "3행 · 이름: …" for the list. */
export const issueText = (x: Issue) => t('{row}행 {name}: {error}', { row: x.rowIndex + 1, name: x.objName, error: x.detail });
