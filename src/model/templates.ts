import { newDesign, newObject, newProject, newRow } from './defaults';
import { PAPER_PRESETS, roll, sheet } from './presets';
import type { LabelObject, Paper, Project, StyleRule, TextObj } from './types';

type P<T> = Partial<T> & Record<string, unknown>;

function text(x: number, y: number, w: number, h: number, content: string, o: P<TextObj> = {}): LabelObject {
  return { ...newObject('text', x, y, w, h), name: content.replace(/[{}]/g, '').slice(0, 16) || '텍스트', content, ...o } as LabelObject;
}
function obj(type: LabelObject['type'], x: number, y: number, w: number, h: number, o: Record<string, unknown> = {}): LabelObject {
  return { ...newObject(type, x, y, w, h), ...o } as LabelObject;
}
const solid = (color: string) => ({ type: 'solid' as const, color });

const ROLE_RULES: StyleRule[] = [
  { column: '참가구분', op: 'eq', value: '연사', set: { color: '#b91c1c' } },
  { column: '참가구분', op: 'eq', value: '좌장', set: { color: '#7c3aed' } },
  { column: '참가구분', op: 'eq', value: '학생', set: { color: '#0369a1' } },
  { column: '참가구분', op: 'eq', value: '스태프', set: { color: '#15803d' } },
];

const ATTENDEES: [string, string, string, string, string, string][] = [
  ['김하늘', '서울대학교 전기정보공학부', '교수', '연사', 'A0001', 'sky.kim@example.ac.kr'],
  ['이도윤', '한국과학기술원 기계공학과', '부교수', '좌장', 'A0002', 'doyoon@example.ac.kr'],
  ['박서연', '연세대학교', '박사과정', '학생', 'A0003', 'seoyeon@example.ac.kr'],
  ['최민준', '(주)라벨테크 연구소', '수석연구원', '일반', 'A0004', 'mj.choi@example.com'],
  ['정예린', '포항공과대학교 화학공학과', '석사과정', '학생', 'A0005', 'yerin@example.ac.kr'],
  ['Emily Johnson', 'University of California, Berkeley', 'Professor', '연사', 'A0006', 'emily@example.edu'],
  ['강지호', '고려대학교 의과대학 의생명과학교실', '연구교수', '일반', 'A0007', 'jiho@example.ac.kr'],
  ['윤서아', '학회 사무국', '', '스태프', 'A0008', 'office@example.org'],
  ['Hiroshi Tanaka', 'The University of Tokyo', 'Associate Professor', '일반', 'A0009', 'tanaka@example.jp'],
  ['한지민', '성균관대학교', '학부생', '학생', 'A0010', 'jimin@example.ac.kr'],
];

function attendeeTable() {
  return {
    columns: ['이름', '소속', '직함', '참가구분', 'ID', '이메일'],
    rows: ATTENDEES.map(([a, b, c, d, e, f]) => newRow({ 이름: a, 소속: b, 직함: c, 참가구분: d, ID: e, 이메일: f })),
  };
}

function badge(paper: Paper): Project {
  const W = paper.labelWidth, H = paper.labelHeight;
  const band = Math.max(7, H * 0.16);
  const objects: LabelObject[] = [
    obj('rect', 0, 0, W, band, { name: '상단 띠', fill: solid('#1e3a8a'), strokeWidth: 0, rules: ROLE_RULES }),
    text(3, 0.8, W - 6, band - 1.6, '2026 추계 학술대회', { name: '행사명', fill: solid('#ffffff'), bold: true, fontSize: 10, align: 'center' }),
    text(4, band + 4, W * 0.66, H * 0.24, '{{이름}}', {
      name: '이름', bold: true, fontSize: 28, minFontSize: 12, rules: [{ column: '', op: 'latin', value: '', set: { fontSize: 20 } }],
    }),
    text(4, band + 4 + H * 0.24, W * 0.66, H * 0.15, '{{소속}}', { name: '소속', fontSize: 11, minFontSize: 6 }),
    text(4, band + 4 + H * 0.39, W * 0.66, H * 0.1, '{{직함}}', { name: '직함', fontSize: 9, fill: solid('#4b5563'), hideIfEmpty: true }),
    obj('qr', W - 4 - H * 0.36, band + 5, H * 0.36, H * 0.36, { name: 'QR', content: '{{ID}}' }),
    text(W - 6 - H * 0.36, band + 5.5 + H * 0.36, H * 0.36 + 4, 4, '{{ID}}', { name: 'ID', fontSize: 7, align: 'center', fill: solid('#4b5563') }),
    obj('rect', 0, H - band, W, band, { name: '하단 띠', fill: solid('#1e3a8a'), strokeWidth: 0, rules: ROLE_RULES }),
    text(3, H - band + 0.8, W - 6, band - 1.6, '{{참가구분}}', { name: '참가구분', fill: solid('#ffffff'), bold: true, fontSize: 13, align: 'center' }),
  ];
  const p = newProject(paper, [newDesign('일반 명찰', objects)], '학술대회 명찰');
  p.data = attendeeTable();
  return p;
}

function nameTent(): Project {
  const paper = PAPER_PRESETS[1].items.find((x) => x.name.startsWith('테이블'))!;
  const objects: LabelObject[] = [
    obj('line', 10, 104.5, 277, 1, { name: '접는 선', stroke: '#9ca3af', strokeWidth: 0.3, dash: true }),
    text(20, 22, 257, 50, '{{이름}}', { name: '이름(뒤)', fontSize: 80, minFontSize: 30, bold: true, align: 'center', rotation: 180 }),
    text(20, 72, 257, 20, '{{소속}}', { name: '소속(뒤)', fontSize: 28, minFontSize: 12, align: 'center', rotation: 180 }),
    text(20, 120, 257, 50, '{{이름}}', { name: '이름', fontSize: 80, minFontSize: 30, bold: true, align: 'center' }),
    text(20, 170, 257, 20, '{{소속}}', { name: '소속', fontSize: 28, minFontSize: 12, align: 'center' }),
  ];
  const p = newProject(paper, [newDesign('네임텐트', objects)], '테이블 네임텐트');
  p.data = attendeeTable();
  return p;
}

function shipping(): Project {
  const paper = roll('택배 100×150', 100, 150);
  const objects: LabelObject[] = [
    text(5, 4, 90, 8, '받는 분', { bold: true, fontSize: 12 }),
    text(5, 13, 90, 10, '{{받는분}}  {{받는분연락처}}', { fontSize: 16, bold: true }),
    text(5, 24, 90, 22, '{{받는주소}}', { multiline: true, vAlign: 'top', fontSize: 14 }),
    obj('line', 5, 48, 90, 1, { strokeWidth: 0.4 }),
    text(5, 51, 90, 6, '보내는 분: {{보내는분}}  {{보내는분연락처}}', { fontSize: 10 }),
    text(5, 58, 90, 12, '{{보내는주소}}', { multiline: true, vAlign: 'top', fontSize: 9, fill: solid('#374151') }),
    obj('line', 5, 73, 90, 1, { strokeWidth: 0.4 }),
    text(5, 77, 60, 7, '품목: {{품목}}', { fontSize: 11 }),
    obj('qr', 72, 76, 22, 22, { content: '{{운송장번호}}' }),
    obj('barcode', 8, 105, 84, 30, { content: '{{운송장번호}}', textSize: 10 }),
  ];
  const p = newProject(paper, [newDesign('택배', objects)], '택배 송장');
  p.data = {
    columns: ['운송장번호', '받는분', '받는분연락처', '받는주소', '보내는분', '보내는분연락처', '보내는주소', '품목'],
    rows: [1, 2, 3].map((i) => newRow({
      운송장번호: `52410000${i}234`, 받는분: ['김하늘', '이도윤', '박서연'][i - 1], 받는분연락처: '010-0000-000' + i,
      받는주소: '서울특별시 관악구 관악로 1, 301동 ' + (100 + i) + '호', 보내는분: '라벨룸 상사', 보내는분연락처: '02-000-0000',
      보내는주소: '경기도 성남시 분당구 판교역로 000', 품목: ['도서', '의류', '전자부품'][i - 1],
    })),
  };
  return p;
}

function asset(): Project {
  const paper = sheet('A4 4×10 (48.5×25.4)', { width: 210, height: 297 }, 48.5, 25.4, 4, 10);
  const objects: LabelObject[] = [
    text(2, 1.5, 30, 4.5, '자산관리 라벨', { fontSize: 7, bold: true, fill: solid('#1e3a8a') }),
    text(2, 6, 30, 5, '{{품명}}', { fontSize: 9 }),
    obj('barcode', 2, 11.5, 30, 12, { content: '{{자산번호}}', textSize: 6 }),
    obj('qr', 34, 4, 12.5, 12.5, { content: '{{자산번호}}' }),
    text(33, 17.5, 14.5, 5, '{{부서}}', { fontSize: 6, align: 'center' }),
  ];
  const p = newProject(paper, [newDesign('자산', objects)], '자산관리 라벨');
  p.data = {
    columns: ['자산번호', '품명', '부서'],
    rows: Array.from({ length: 12 }, (_, i) => newRow({ 자산번호: `IT-2026-${String(i + 1).padStart(4, '0')}`, 품명: ['노트북', '모니터', '프린터'][i % 3], 부서: ['연구팀', '총무팀', '개발팀'][i % 3] })),
  };
  return p;
}

function price(): Project {
  const paper = roll('60×40', 60, 40, 1.5);
  const objects: LabelObject[] = [
    text(3, 2, 54, 7, '{{상품명}}', { fontSize: 12, bold: true }),
    text(3, 9, 54, 12, '{{가격}}원', { fontSize: 26, bold: true, align: 'right', fill: solid('#b91c1c') }),
    obj('barcode', 3, 22, 54, 16, { content: '{{바코드}}', symbology: 'ean13', textSize: 7 }),
  ];
  const p = newProject(paper, [newDesign('가격표', objects)], '가격표');
  p.data = { columns: ['상품명', '가격', '바코드'], rows: [newRow({ 상품명: '유기농 녹차 500g', 가격: '12,900', 바코드: '880123456789' }), newRow({ 상품명: '현미 2kg', 가격: '8,500', 바코드: '880987654321' })] };
  return p;
}

function qrSticker(): Project {
  const paper = sheet('A4 4×6 (45×45)', { width: 210, height: 297 }, 45, 45, 4, 6, 3, 3, 3);
  const objects: LabelObject[] = [
    obj('qr', 7.5, 3, 30, 30, { content: '{{URL}}', errorLevel: 'Q' }),
    text(2, 34, 41, 8, '{{설명}}', { fontSize: 9, align: 'center', bold: true }),
  ];
  const p = newProject(paper, [newDesign('QR', objects)], 'QR 스티커');
  p.data = { columns: ['URL', '설명'], rows: [newRow({ URL: 'https://example.com/program', 설명: '프로그램 안내' }), newRow({ URL: 'https://example.com/survey', 설명: '만족도 조사' })] };
  return p;
}

function seat(): Project {
  const paper = sheet('A4 3×8 (63.5×33.9)', { width: 210, height: 297 }, 63.5, 33.9, 3, 8, 2.5, 0, 2);
  const objects: LabelObject[] = [
    text(3, 2, 57.5, 6, '좌석 번호', { fontSize: 9, align: 'center', fill: solid('#6b7280') }),
    text(3, 8, 57.5, 22, '{{#seq:000}}', { fontSize: 48, bold: true, align: 'center' }),
  ];
  const p = newProject(paper, [newDesign('좌석', objects)], '좌석·포스터 번호');
  return p;
}

export interface Template { id: string; name: string; desc: string; make: () => Project }

export const TEMPLATES: Template[] = [
  { id: 'blank', name: '빈 라벨', desc: '롤 라벨 50×30', make: () => newProject(roll('50×30', 50, 30, 1.5)) },
  { id: 'badge25', name: '학술대회 명찰', desc: 'A4 2×5 (90×55) · 참가구분별 색 띠 · QR', make: () => badge(PAPER_PRESETS[1].items[0]) },
  { id: 'badge-a6', name: '목걸이 명찰', desc: 'A6 105×148', make: () => badge(roll('목걸이 명찰 A6 (105×148)', 105, 148)) },
  { id: 'tent', name: '테이블 네임텐트', desc: 'A4 가로 · 반 접기 (위쪽 180° 회전)', make: nameTent },
  { id: 'seat', name: '좌석·포스터 번호', desc: 'A4 3×8 · 일련번호', make: seat },
  { id: 'qr', name: 'QR 스티커', desc: 'A4 4×6 (45×45)', make: qrSticker },
  { id: 'ship', name: '택배 송장', desc: '100×150 · Code128 + QR', make: shipping },
  { id: 'asset', name: '자산관리 라벨', desc: 'A4 4×10 · 바코드 + QR', make: asset },
  { id: 'price', name: '가격표', desc: '60×40 · EAN-13', make: price },
];
