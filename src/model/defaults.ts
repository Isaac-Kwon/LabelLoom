import type {
  BarcodeObj, Design, ImageObj, LabelObject, ObjType, Paper, Project, QrObj, Row, ShapeObj, SvgObj, TableObj, TextObj,
} from './types';
import { SCHEMA_VERSION } from './types';
import { WEEKDAYS, weeklyLayout } from './tableLayouts';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const DEFAULT_FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

const base = (type: ObjType, x: number, y: number, w: number, h: number) => ({
  id: uid(), type, name: '', x, y, w, h, rotation: 0, opacity: 1, locked: false, hidden: false,
  rules: [], hideIfEmpty: false,
});

export const TYPE_LABEL: Record<ObjType, string> = {
  text: '텍스트', rect: '사각형', ellipse: '원', triangle: '삼각형', line: '선',
  barcode: '바코드', qr: 'QR/2D 코드', image: '이미지', svg: 'SVG', table: '표',
};


export function newObject(type: ObjType, x = 5, y = 5, w?: number, h?: number): LabelObject {
  switch (type) {
    case 'text': {
      const o: TextObj = {
        ...base('text', x, y, w ?? 40, h ?? 10), type: 'text', content: '텍스트',
        fontFamily: DEFAULT_FONT, fontSize: 14, minFontSize: 6, bold: false, italic: false, underline: false,
        align: 'left', vAlign: 'middle', multiline: false, fit: 'shrink', letterSpacing: 0, lineHeight: 1.2,
        ellipsis: false, fill: { type: 'solid', color: '#111111' }, effects: {},
      };
      return o;
    }
    case 'rect': case 'ellipse': case 'triangle': case 'line': {
      const o: ShapeObj = {
        ...base(type, x, y, w ?? (type === 'line' ? 30 : 20), h ?? (type === 'line' ? 1 : 15)), type,
        fill: type === 'line' ? { type: 'none' } : { type: 'solid', color: '#e8eefc' },
        stroke: '#1f2937', strokeWidth: type === 'line' ? 0.5 : 0.3, cornerRadius: 0, dash: false, effects: {},
      };
      return o;
    }
    case 'barcode': {
      const o: BarcodeObj = {
        ...base('barcode', x, y, w ?? 40, h ?? 15), type: 'barcode', content: '1234567890',
        symbology: 'code128', showText: true, textSize: 8, color: '#000000', background: '', keepAspect: false,
      };
      return o;
    }
    case 'qr': {
      const o: QrObj = {
        ...base('qr', x, y, w ?? 18, h ?? 18), type: 'qr', content: 'https://example.com',
        symbology: 'qrcode', errorLevel: 'M', quietZone: 0, color: '#000000', background: '', logoScale: 0.22,
      };
      return o;
    }
    case 'image': {
      const o: ImageObj = { ...base('image', x, y, w ?? 20, h ?? 20), type: 'image', src: '', fit: 'contain' };
      return o;
    }
    case 'svg': {
      const o: SvgObj = { ...base('svg', x, y, w ?? 20, h ?? 20), type: 'svg', svg: '', fit: 'contain' };
      return o;
    }
    case 'table': {
      const o: TableObj = {
        ...base('table', x, y, w ?? 60, h ?? 30), type: 'table',
        ...weeklyLayout({ days: WEEKDAYS.slice(0, 5), periods: 4, showTimes: false, start: '09:00', lesson: 50, rest: 10, lunchAfter: 0, lunch: 60 }),
        fontFamily: DEFAULT_FONT, fontSize: 9, minFontSize: 4, color: '#111111', align: 'center', vAlign: 'middle',
        padding: 0.6, fill: '', headerRow: true, headerCol: true, headerFill: '#e8eefc', headerColor: '#111111',
        borderColor: '#1f2937', borderWidth: 0.2, outerWidth: 0.4,
      };
      return o;
    }
  }
}

export function newDesign(name = '디자인 1', objects: LabelObject[] = []): Design {
  return { id: uid(), name, objects };
}

export function newRow(values: Record<string, string> = {}): Row {
  return { id: uid(), print: true, copies: 1, values };
}

export function newProject(paper: Paper, designs?: Design[], name = '새 라벨'): Project {
  return {
    app: 'labelloom', version: SCHEMA_VERSION, name, paper,
    designs: designs ?? [newDesign()], designRules: [], fonts: [],
    data: { columns: [], rows: [] },
    calibration: { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
    seqStart: 1,
  };
}

/** Fill in missing fields so older or hand-edited files keep loading. */
export function migrateProject(raw: unknown): Project {
  const p = raw as Partial<Project>;
  if (!p || typeof p !== 'object' || !p.paper || !Array.isArray(p.designs)) throw new Error('LabelLoom 프로젝트 파일이 아닙니다.');
  const def = newProject(p.paper as Paper);
  const proj: Project = { ...def, ...p, app: 'labelloom', version: SCHEMA_VERSION } as Project;
  proj.paper = { ...def.paper, ...p.paper };
  proj.data = { columns: p.data?.columns ?? [], rows: (p.data?.rows ?? []).map((r) => ({ ...newRow(), ...r })) };
  proj.calibration = { ...def.calibration, ...(p.calibration ?? {}) };
  proj.designs = p.designs.map((d) => ({
    ...d,
    objects: d.objects.map(fixObj),
    back: d.back?.map(fixObj),
  }));
  if (!proj.designs.length) proj.designs = [newDesign()];
  return proj;
}

function fixObj(o: LabelObject): LabelObject {
  const d = newObject(o.type) as LabelObject;
  return { ...d, ...o, rules: o.rules ?? [] } as LabelObject;
}
