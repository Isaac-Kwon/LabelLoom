import { newDesign, newObject, newProject, newRow } from './defaults';
import { PAPER_PRESETS, preset } from './presets';
import { preprintArea } from '../render/preprint';
import type { DataTable, LabelObject, Paper, Project, StyleRule, TextObj } from './types';

type P<T> = Partial<T> & Record<string, unknown>;

function text(x: number, y: number, w: number, h: number, content: string, o: P<TextObj> = {}): LabelObject {
  return { ...newObject('text', x, y, w, h), name: content.replace(/[{}]/g, '').slice(0, 16) || '텍스트', content, ...o } as LabelObject;
}
function obj(type: LabelObject['type'], x: number, y: number, w: number, h: number, o: Record<string, unknown> = {}): LabelObject {
  return { ...newObject(type, x, y, w, h), ...o } as LabelObject;
}
const solid = (color: string) => ({ type: 'solid' as const, color });
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Move a layout drawn from the label's corner into the writable area of a pre-printed label. */
function inArea(objects: LabelObject[], paper: Paper): LabelObject[] {
  const a = preprintArea(paper);
  if (!a.x && !a.y) return objects;
  return objects.map((o) => ({ ...o, x: r1(o.x + a.x), y: r1(o.y + a.y) }));
}

/**
 * Scale a layout drawn for a `refW`×`refH` label onto `paper`'s label size (its writable
 * area on pre-printed stock), so every template works on any size.
 * Codes stay square, lines keep their thickness and fonts follow the smaller axis
 * (text boxes shrink-to-fit, so a font that is still too big just shrinks).
 */
function fitTo(objects: LabelObject[], refW: number, refH: number, paper: Paper): LabelObject[] {
  const a = preprintArea(paper);
  const sx = a.w / refW, sy = a.h / refH, s = Math.min(sx, sy);
  return inArea(objects.map((o) => {
    const n = { ...o, x: r1(o.x * sx), y: r1(o.y * sy), w: r1(o.w * sx), h: r1(o.h * sy) } as LabelObject;
    if (n.type === 'line') { n.h = o.h; n.y = r1((o.y + o.h / 2) * sy - o.h / 2); }
    if (n.type === 'qr') {
      const d = Math.min(n.w, n.h);
      n.x = r1(n.x + (n.w - d) / 2); n.y = r1(n.y + (n.h - d) / 2); n.w = n.h = d;
    }
    if (n.type === 'text') { n.fontSize = r1(n.fontSize * s); n.minFontSize = Math.max(4, r1(n.minFontSize * s)); }
    if (n.type === 'barcode') n.textSize = Math.max(4, r1(n.textSize * s));
    return n;
  }), paper);
}

function project(paper: Paper, design: string, objects: LabelObject[], name: string, data?: DataTable): Project {
  const p = newProject({ ...paper }, [newDesign(design, objects)], name);
  if (data) p.data = data;
  return p;
}

function table(columns: string[], rows: string[][]): DataTable {
  return { columns, rows: rows.map((r) => newRow(Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])))) };
}

/* ---------- 명찰 ---------- */

const ROLE_RULES: StyleRule[] = [
  { column: '참가구분', op: 'eq', value: '연사', set: { color: '#b91c1c' } },
  { column: '참가구분', op: 'eq', value: '좌장', set: { color: '#7c3aed' } },
  { column: '참가구분', op: 'eq', value: '학생', set: { color: '#0369a1' } },
  { column: '참가구분', op: 'eq', value: '스태프', set: { color: '#15803d' } },
];

const ATTENDEES: string[][] = [
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
const attendeeTable = () => table(['이름', '소속', '직함', '참가구분', 'ID', '이메일'], ATTENDEES);

function badge(paper: Paper): Project {
  const { w: W, h: H } = preprintArea(paper);
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
  return project(paper, '일반 명찰', inArea(objects, paper), '학술대회 명찰', attendeeTable());
}

/** One look for every attendee: no role column, the footer carries the date and venue. */
function plainBadge(paper: Paper): Project {
  const objects = fitTo([
    obj('rect', 0, 0, 90, 10, { name: '상단 띠', fill: solid('#1e3a8a'), strokeWidth: 0 }),
    text(4, 1, 82, 8, '2026 추계 학술대회', { name: '행사명', fill: solid('#ffffff'), bold: true, fontSize: 11, align: 'center' }),
    text(5, 14, 58, 14, '{{이름}}', { name: '이름', bold: true, fontSize: 28, minFontSize: 12 }),
    text(5, 28.5, 58, 7, '{{소속}}', { name: '소속', fontSize: 11, minFontSize: 6 }),
    text(5, 35.5, 58, 5, '{{직함}}', { name: '직함', fontSize: 9, fill: solid('#4b5563'), hideIfEmpty: true }),
    obj('qr', 67, 14, 18, 18, { name: 'QR', content: '{{ID}}' }),
    text(64, 32.5, 24, 4, '{{ID}}', { name: 'ID', fontSize: 7, align: 'center', fill: solid('#4b5563') }),
    obj('rect', 0, 47, 90, 8, { name: '하단 띠', fill: solid('#e0e7ff'), strokeWidth: 0 }),
    text(4, 47.8, 82, 6.4, '2026. 11. 6.(금) – 7.(토) · 대전컨벤션센터', { name: '일시·장소', fill: solid('#1e3a8a'), fontSize: 9, align: 'center' }),
  ], 90, 55, paper);
  const cols = ['이름', '소속', '직함', 'ID', '이메일'];
  return project(paper, '공통 명찰', objects, '학술대회 명찰 (공통)', table(cols, ATTENDEES.map(([n, a, t, , id, m]) => [n, a, t, id, m])));
}

function simpleBadge(paper: Paper): Project {
  const objects = fitTo([
    obj('rect', 0, 0, 3, 55, { name: '포인트 띠', fill: solid('#0f766e'), strokeWidth: 0 }),
    text(8, 6, 76, 6, '{{소속}}', { name: '소속', fontSize: 11, minFontSize: 6, fill: solid('#4b5563') }),
    text(8, 15, 76, 20, '{{이름}}', { name: '이름', fontSize: 36, minFontSize: 14, bold: true }),
    obj('line', 8, 38, 74, 1, { name: '구분선', stroke: '#0f766e', strokeWidth: 0.4 }),
    text(8, 42, 76, 7, '{{직함}}', { name: '직함', fontSize: 11, hideIfEmpty: true }),
  ], 90, 55, paper);
  return project(paper, '심플 명찰', objects, '심플 명찰', attendeeTable());
}

function nameTent(paper: Paper): Project {
  const objects = fitTo([
    obj('line', 10, 104.5, 277, 1, { name: '접는 선', stroke: '#9ca3af', strokeWidth: 0.3, dash: true }),
    text(20, 22, 257, 50, '{{이름}}', { name: '이름(뒤)', fontSize: 80, minFontSize: 30, bold: true, align: 'center', rotation: 180 }),
    text(20, 72, 257, 20, '{{소속}}', { name: '소속(뒤)', fontSize: 28, minFontSize: 12, align: 'center', rotation: 180 }),
    text(20, 120, 257, 50, '{{이름}}', { name: '이름', fontSize: 80, minFontSize: 30, bold: true, align: 'center' }),
    text(20, 170, 257, 20, '{{소속}}', { name: '소속', fontSize: 28, minFontSize: 12, align: 'center' }),
  ], 297, 210, paper);
  return project(paper, '네임텐트', objects, '테이블 네임텐트', attendeeTable());
}

function seat(paper: Paper): Project {
  const objects = fitTo([
    text(3, 2, 57.5, 6, '좌석 번호', { fontSize: 9, align: 'center', fill: solid('#6b7280') }),
    text(3, 8, 57.5, 22, '{{#seq:000}}', { fontSize: 48, bold: true, align: 'center' }),
  ], 63.5, 33.9, paper);
  return project(paper, '좌석', objects, '좌석·포스터 번호');
}

function ticket(paper: Paper): Project {
  const objects = fitTo([
    obj('rect', 0, 0, 100, 9, { name: '상단 띠', fill: solid('#7c2d12'), strokeWidth: 0 }),
    text(3, 1, 70, 7, '{{행사명}}', { name: '행사명', fontSize: 12, bold: true, fill: solid('#ffffff') }),
    text(3, 12, 70, 6, '{{일시}}', { name: '일시', fontSize: 10 }),
    text(3, 18, 70, 6, '{{장소}}', { name: '장소', fontSize: 10, fill: solid('#4b5563') }),
    text(3, 26, 70, 12, '{{좌석}}', { name: '좌석', fontSize: 24, bold: true }),
    text(3, 41, 70, 6, 'No. {{#seq:00000}}', { name: '일련번호', fontSize: 9, fill: solid('#6b7280') }),
    obj('line', 52, 25, 50, 1, { name: '절취선', stroke: '#9ca3af', strokeWidth: 0.3, dash: true, rotation: 90 }),
    obj('qr', 80, 14, 17, 17, { name: 'QR', content: '{{행사명}}-{{#seq:00000}}' }),
    text(77, 34, 23, 12, '{{좌석}}', { name: '좌석(절취)', fontSize: 12, bold: true, align: 'center' }),
  ], 100, 50, paper);
  return project(paper, '입장권', objects, '입장권·티켓', table(['행사명', '일시', '장소', '좌석'], [
    ['2026 송년 음악회', '2026.12.19 (토) 19:30', '대강당', 'A열 12번'],
    ['2026 송년 음악회', '2026.12.19 (토) 19:30', '대강당', 'A열 13번'],
    ['2026 송년 음악회', '2026.12.19 (토) 19:30', '대강당', 'B열 1번'],
  ]));
}

/* ---------- 우편·물류 ---------- */

function address(paper: Paper): Project {
  const objects = fitTo([
    text(5, 3, 40, 6, '{{우편번호}}', { name: '우편번호', fontSize: 10, letterSpacing: 0.6 }),
    text(5, 9, 89, 14, '{{주소}}', { name: '주소', fontSize: 12, minFontSize: 6, multiline: true, vAlign: 'top' }),
    text(5, 25, 89, 10, '{{이름}} 님', { name: '이름', fontSize: 16, bold: true, align: 'right' }),
  ], 99.1, 38.1, paper);
  return project(paper, '주소', objects, '주소 라벨', table(['우편번호', '주소', '이름'], [
    ['08826', '서울특별시 관악구 관악로 1, 301동 101호', '김하늘'],
    ['34141', '대전광역시 유성구 대학로 291, 기계공학동 3층', '이도윤'],
    ['03722', '서울특별시 서대문구 연세로 50', '박서연'],
  ]));
}

function shipping(paper: Paper): Project {
  const objects = fitTo([
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
  ], 100, 150, paper);
  const p = project(paper, '택배', objects, '택배 송장');
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

/* ---------- 관리·보관 ---------- */

function asset(paper: Paper): Project {
  const objects = fitTo([
    text(2, 1.5, 30, 4.5, '자산관리 라벨', { fontSize: 7, bold: true, fill: solid('#1e3a8a') }),
    text(2, 6, 30, 5, '{{품명}}', { fontSize: 9 }),
    obj('barcode', 2, 11.5, 30, 12, { content: '{{자산번호}}', textSize: 6 }),
    obj('qr', 34, 4, 12.5, 12.5, { content: '{{자산번호}}' }),
    text(33, 17.5, 14.5, 5, '{{부서}}', { fontSize: 6, align: 'center' }),
  ], 48.5, 25.4, paper);
  return project(paper, '자산', objects, '자산관리 라벨', {
    columns: ['자산번호', '품명', '부서'],
    rows: Array.from({ length: 12 }, (_, i) => newRow({ 자산번호: `IT-2026-${String(i + 1).padStart(4, '0')}`, 품명: ['노트북', '모니터', '프린터'][i % 3], 부서: ['연구팀', '총무팀', '개발팀'][i % 3] })),
  });
}

function fileLabel(paper: Paper): Project {
  const objects = fitTo([
    obj('rect', 0, 0, 22, 38.1, { name: '색 띠', fill: solid('#1d4ed8'), strokeWidth: 0, rules: [
      { column: '분류', op: 'eq', value: '회계', set: { color: '#b45309' } },
      { column: '분류', op: 'eq', value: '인사', set: { color: '#be185d' } },
    ] }),
    text(1, 8, 20, 12, '{{연도}}', { name: '연도', fontSize: 18, bold: true, align: 'center', fill: solid('#ffffff') }),
    text(1, 21, 20, 8, '{{분류}}', { name: '분류', fontSize: 10, align: 'center', fill: solid('#ffffff') }),
    text(26, 5, 70, 18, '{{제목}}', { name: '제목', fontSize: 20, minFontSize: 8, bold: true, multiline: true }),
    obj('line', 26, 25, 70, 1, { name: '구분선', stroke: '#d1d5db', strokeWidth: 0.3 }),
    text(26, 28, 70, 7, '{{부서}} · 보존 {{보존기간}}', { name: '부서', fontSize: 10, fill: solid('#4b5563') }),
  ], 99.1, 38.1, paper);
  return project(paper, '파일', objects, '파일·바인더 라벨', table(['연도', '분류', '제목', '부서', '보존기간'], [
    ['2026', '회계', '법인카드 영수증 1분기', '총무팀', '5년'],
    ['2026', '인사', '채용 서류', '인사팀', '3년'],
    ['2025', '사업', '연구과제 최종보고서', '연구팀', '영구'],
  ]));
}

function food(paper: Paper): Project {
  const objects = fitTo([
    text(3, 2, 54, 9, '{{품명}}', { name: '품명', fontSize: 16, bold: true }),
    obj('line', 3, 11.5, 54, 1, { stroke: '#9ca3af', strokeWidth: 0.3 }),
    text(3, 13.5, 54, 5.5, '제조일  {{@date:YYYY.MM.DD}}', { name: '제조일', fontSize: 9 }),
    text(3, 19.5, 54, 6.5, '소비기한  {{소비기한}}', { name: '소비기한', fontSize: 10, bold: true, fill: solid('#b91c1c') }),
    text(3, 26.5, 54, 5, '보관  {{보관방법}}', { name: '보관방법', fontSize: 8 }),
    text(3, 32, 54, 6, '{{원재료}}', { name: '원재료', fontSize: 7, minFontSize: 4, multiline: true, fill: solid('#4b5563') }),
  ], 60, 40, paper);
  return project(paper, '식품', objects, '식품·보관 라벨', table(['품명', '소비기한', '보관방법', '원재료'], [
    ['수제 딸기잼', '2027.04.30', '개봉 후 냉장', '딸기 70%, 설탕, 레몬즙'],
    ['그래놀라', '2026.12.31', '실온, 직사광선 피함', '귀리, 아몬드, 꿀, 코코넛오일'],
  ]));
}

function sample(paper: Paper): Project {
  const objects = fitTo([
    obj('qr', 1.5, 2.5, 16, 16, { name: '데이터매트릭스', content: '{{시료ID}}', symbology: 'datamatrix' }),
    text(19, 1.5, 18, 6, '{{시료ID}}', { name: '시료ID', fontSize: 8, bold: true }),
    text(19, 7.5, 18, 5, '{{시료명}}', { name: '시료명', fontSize: 7 }),
    text(19, 12.5, 18, 4, '{{@date:YY.MM.DD}}', { name: '날짜', fontSize: 6, fill: solid('#4b5563') }),
    text(19, 16.5, 18, 4, '{{담당자}}', { name: '담당자', fontSize: 6, fill: solid('#4b5563') }),
  ], 38.1, 21.2, paper);
  return project(paper, '시료', objects, '시료·튜브 라벨', {
    columns: ['시료ID', '시료명', '담당자'],
    rows: Array.from({ length: 8 }, (_, i) => newRow({ 시료ID: `S26-${String(i + 1).padStart(4, '0')}`, 시료명: ['혈청', '세포 lysate', 'DNA'][i % 3], 담당자: ['박서연', '정예린'][i % 2] })),
  });
}

/* ---------- 판매·스티커 ---------- */

function price(paper: Paper): Project {
  const objects = fitTo([
    text(3, 2, 54, 7, '{{상품명}}', { fontSize: 12, bold: true }),
    text(3, 9, 54, 12, '{{가격}}원', { fontSize: 26, bold: true, align: 'right', fill: solid('#b91c1c') }),
    obj('barcode', 3, 22, 54, 16, { content: '{{바코드}}', symbology: 'ean13', textSize: 7 }),
  ], 60, 40, paper);
  return project(paper, '가격표', objects, '가격표', table(['상품명', '가격', '바코드'], [
    ['유기농 녹차 500g', '12,900', '880123456789'], ['현미 2kg', '8,500', '880987654321'],
  ]));
}

function qrSticker(paper: Paper): Project {
  const objects = fitTo([
    obj('qr', 7.5, 3, 30, 30, { content: '{{URL}}', errorLevel: 'Q' }),
    text(2, 34, 41, 8, '{{설명}}', { fontSize: 9, align: 'center', bold: true }),
  ], 45, 45, paper);
  return project(paper, 'QR', objects, 'QR 스티커', table(['URL', '설명'], [
    ['https://example.com/program', '프로그램 안내'], ['https://example.com/survey', '만족도 조사'],
  ]));
}

function roundSticker(paper: Paper): Project {
  const objects = fitTo([
    obj('ellipse', 2, 2, 36, 36, { name: '테두리', fill: { type: 'none' }, stroke: '#be185d', strokeWidth: 0.6 }),
    text(6, 9, 28, 6, '{{위}}', { name: '윗줄', fontSize: 8, align: 'center', fill: solid('#be185d') }),
    text(5, 15, 30, 11, '{{문구}}', { name: '문구', fontSize: 18, bold: true, align: 'center' }),
    text(6, 26, 28, 5, '{{아래}}', { name: '아랫줄', fontSize: 7, align: 'center', fill: solid('#4b5563') }),
  ], 40, 40, paper);
  return project(paper, '원형', objects, '원형 스티커', table(['위', '문구', '아래'], [
    ['HANDMADE', '감사합니다', 'LabelLoom'], ['SPECIAL', '선물용', '2026'],
  ]));
}

function nameSticker(paper: Paper): Project {
  const objects = fitTo([
    obj('ellipse', 2.5, 5, 15, 15, { name: '원', fill: solid('#fde68a'), strokeWidth: 0 }),
    text(2.5, 5, 15, 15, '{{번호}}', { name: '번호', fontSize: 14, bold: true, align: 'center' }),
    text(20, 3, 26, 6, '{{반}}', { name: '반', fontSize: 8, fill: solid('#4b5563') }),
    text(20, 9, 26, 13, '{{이름}}', { name: '이름', fontSize: 20, bold: true }),
  ], 48.5, 25.4, paper);
  return project(paper, '이름', objects, '이름 스티커', table(['반', '번호', '이름'], [
    ['3학년 2반', '1', '김하늘'], ['3학년 2반', '2', '이도윤'], ['3학년 2반', '3', '박서연'],
  ]));
}

/* ---------- registry ---------- */

export interface Template {
  id: string;
  name: string;
  desc: string;
  /** paper sizes this layout works on; the first is the default */
  papers: Paper[];
  make: (paper: Paper) => Project;
}

const ps = (...names: string[]) => names.map(preset);

export const TEMPLATES: Template[] = [
  { id: 'blank', name: '빈 라벨', desc: '모든 용지 · 처음부터 디자인', papers: [preset('50×30'), ...PAPER_PRESETS.flatMap((g) => g.items).filter((p) => p.name !== '50×30')], make: (p) => newProject({ ...p }) },
  { id: 'badge', name: '학술대회 명찰', desc: '참가구분별 색 띠 · QR', papers: ps('A4 명찰 2×5 (90×55)', 'A4 명찰 2×4 (90×60)', 'A4 명찰 2×3 (100×70)', '명찰 단면 90×55', '명찰 100×70', '목걸이 명찰 A6 (105×148)'), make: badge },
  { id: 'badge-plain', name: '학술대회 명찰 (공통)', desc: '역할 구분 없음 · 일시·장소 · QR', papers: ps('A4 명찰 2×5 (90×55)', 'A4 명찰 2×4 (90×60)', 'A4 명찰 2×3 (100×70)', '명찰 단면 90×55', '명찰 100×70', '목걸이 명찰 A6 (105×148)'), make: plainBadge },
  { id: 'badge-simple', name: '심플 명찰', desc: '소속 · 이름 · 직함', papers: ps('A4 명찰 2×5 (90×55)', 'A4 명찰 2×4 (90×60)', 'A4 명찰 2×3 (100×70)', '명찰 단면 90×55', '명찰 100×70', 'A4 2×7 (99.1×38.1)', 'Letter 2×5 (101.6×50.8)'), make: simpleBadge },
  { id: 'tent', name: '테이블 네임텐트', desc: '반 접기 (위쪽 180° 회전)', papers: ps('테이블 네임텐트 (A4 가로)', '테이블 네임텐트 (Letter 가로)'), make: nameTent },
  { id: 'ticket', name: '입장권·티켓', desc: '일련번호 · 절취선 · QR', papers: ps('100×50', 'A4 명찰 2×5 (90×55)', 'Letter 2×5 (101.6×50.8)', 'A4 2×7 (99.1×38.1)'), make: ticket },
  { id: 'seat', name: '좌석·포스터 번호', desc: '일련번호', papers: ps('A4 3×8 (63.5×33.9)', 'A4 3×7 (63.5×38.1)', 'A4 2×7 (99.1×38.1)', 'A4 2×8 (99.1×33.9)', 'A4 4×10 (48.5×25.4)', '50×30', '60×40', 'Letter 3×10 (66.7×25.4)'), make: seat },
  { id: 'address', name: '주소 라벨', desc: '우편번호 · 주소 · 받는 분', papers: ps('A4 2×7 (99.1×38.1)', 'A4 2×8 (99.1×33.9)', 'A4 3×7 (63.5×38.1)', 'A4 3×8 (63.5×33.9)', 'Letter 3×10 (66.7×25.4)', 'Letter 2×5 (101.6×50.8)', '100×50'), make: address },
  { id: 'ship', name: '택배 송장', desc: 'Code128 + QR', papers: ps('택배 100×150', 'A4 2×2 (105×148.5)', '목걸이 명찰 A6 (105×148)'), make: shipping },
  { id: 'file', name: '파일·바인더 라벨', desc: '분류별 색 띠 · 보존기간', papers: ps('A4 2×7 (99.1×38.1)', 'A4 2×8 (99.1×33.9)', 'Letter 2×5 (101.6×50.8)', '100×50', 'A4 3×7 (63.5×38.1)'), make: fileLabel },
  { id: 'asset', name: '자산관리 라벨', desc: '바코드 + QR', papers: ps('A4 4×10 (48.5×25.4)', 'A4 5×13 (38.1×21.2)', 'A4 3×8 (63.5×33.9)', '50×30', '40×20', '60×40', 'Letter 3×10 (66.7×25.4)'), make: asset },
  { id: 'sample', name: '시료·튜브 라벨', desc: 'DataMatrix · 날짜 · 담당자', papers: ps('A4 5×13 (38.1×21.2)', '40×20', '30×20', 'A4 4×10 (48.5×25.4)', '50×30'), make: sample },
  { id: 'food', name: '식품·보관 라벨', desc: '제조일(오늘) · 소비기한 · 원재료', papers: ps('60×40', '50×30', 'A4 3×7 (63.5×38.1)', 'A4 3×8 (63.5×33.9)', 'A4 4×10 (48.5×25.4)', '100×50'), make: food },
  { id: 'price', name: '가격표', desc: 'EAN-13 바코드', papers: ps('60×40', '50×30', '40×20', 'A4 3×7 (63.5×38.1)', 'A4 4×10 (48.5×25.4)'), make: price },
  { id: 'qr', name: 'QR 스티커', desc: 'QR + 설명', papers: ps('A4 4×6 (45×45)', '정사각 40×40', 'A4 3×7 (63.5×38.1)', '60×40'), make: qrSticker },
  { id: 'round', name: '원형 스티커', desc: '포장·감사 스티커', papers: ps('A4 원형 4×6 (Ø40)', 'A4 원형 3×4 (Ø60)', '원형 Ø40', '정사각 40×40', 'A4 4×6 (45×45)'), make: roundSticker },
  { id: 'name', name: '이름 스티커', desc: '학용품 · 반 · 번호', papers: ps('A4 4×10 (48.5×25.4)', 'A4 5×13 (38.1×21.2)', 'A4 3×8 (63.5×33.9)', '50×30', '40×20', 'Letter 3×10 (66.7×25.4)'), make: nameSticker },
];
