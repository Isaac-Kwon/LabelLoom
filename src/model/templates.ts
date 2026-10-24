import { m, pick, t, type Msg } from '../i18n';
import { newDesign, newObject, newProject, newRow } from './defaults';
import { PAPER_PRESETS, preset } from './presets';
import { preprintArea } from '../render/preprint';
import type { DataTable, LabelObject, Paper, Project, StyleRule, TextObj } from './types';

/*
 * Templates are built in the UI language: column names, fixed text and sample rows.
 * Column names go through t() (the same words as elsewhere in the UI), sample rows are
 * picked per language since they are made-up data rather than translations.
 */

type P<T> = Partial<T> & Record<string, unknown>;

/** A column name, and a {{column}} reference to it. */
const c = (k: Msg) => t(k);
const f = (k: Msg) => `{{${t(k)}}}`;

function text(x: number, y: number, w: number, h: number, content: string, o: P<TextObj> = {}): LabelObject {
  return { ...newObject('text', x, y, w, h), name: content.replace(/[{}]/g, '').slice(0, 16) || t('텍스트'), content, ...o } as LabelObject;
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
  return { columns, rows: rows.map((r) => newRow(Object.fromEntries(columns.map((col, i) => [col, r[i] ?? ''])))) };
}

/* ---------- 명찰 ---------- */

const ROLE_COLORS: [Msg, string][] = [[m('연사'), '#b91c1c'], [m('좌장'), '#7c3aed'], [m('학생'), '#0369a1'], [m('스태프'), '#15803d']];
const roleRules = (): StyleRule[] => ROLE_COLORS.map(([role, color]) => ({ column: c('참가구분'), op: 'eq', value: t(role), set: { color } }));

/** name, affiliation, title, role, id, email */
type Attendee = [string, string, string, Msg, string, string];

const attendees = (): Attendee[] => pick<Attendee[]>({
  ko: [
    ['김하늘', '서울대학교 전기정보공학부', '교수', m('연사'), 'A0001', 'sky.kim@example.ac.kr'],
    ['이도윤', '한국과학기술원 기계공학과', '부교수', m('좌장'), 'A0002', 'doyoon@example.ac.kr'],
    ['박서연', '연세대학교', '박사과정', m('학생'), 'A0003', 'seoyeon@example.ac.kr'],
    ['최민준', '(주)라벨테크 연구소', '수석연구원', m('일반'), 'A0004', 'mj.choi@example.com'],
    ['정예린', '포항공과대학교 화학공학과', '석사과정', m('학생'), 'A0005', 'yerin@example.ac.kr'],
    ['Emily Johnson', 'University of California, Berkeley', 'Professor', m('연사'), 'A0006', 'emily@example.edu'],
    ['강지호', '고려대학교 의과대학 의생명과학교실', '연구교수', m('일반'), 'A0007', 'jiho@example.ac.kr'],
    ['윤서아', '학회 사무국', '', m('스태프'), 'A0008', 'office@example.org'],
    ['Hiroshi Tanaka', 'The University of Tokyo', 'Associate Professor', m('일반'), 'A0009', 'tanaka@example.jp'],
    ['한지민', '성균관대학교', '학부생', m('학생'), 'A0010', 'jimin@example.ac.kr'],
  ],
  en: [
    ['Emily Johnson', 'University of California, Berkeley', 'Professor', m('연사'), 'A0001', 'emily@example.edu'],
    ['Daniel Okafor', 'Department of Mechanical Engineering, MIT', 'Associate Professor', m('좌장'), 'A0002', 'okafor@example.edu'],
    ['Sophie Turner', 'University of Edinburgh', 'PhD Student', m('학생'), 'A0003', 'sophie.t@example.ac.uk'],
    ['Michael Chen', 'LabelTech Research Ltd.', 'Principal Scientist', m('일반'), 'A0004', 'm.chen@example.com'],
    ['Priya Raman', 'Imperial College London, Chemical Engineering', 'MSc Student', m('학생'), 'A0005', 'priya@example.ac.uk'],
    ['Kim Haneul', 'Seoul National University', 'Professor', m('연사'), 'A0006', 'sky.kim@example.ac.kr'],
    ['James O\'Neill', 'Johns Hopkins School of Medicine, Department of Biomedical Sciences', 'Research Professor', m('일반'), 'A0007', 'joneill@example.edu'],
    ['Laura Smith', 'Conference Office', '', m('스태프'), 'A0008', 'office@example.org'],
    ['Hiroshi Tanaka', 'The University of Tokyo', 'Associate Professor', m('일반'), 'A0009', 'tanaka@example.jp'],
    ['Anna Kowalski', 'University of Toronto', 'Undergraduate', m('학생'), 'A0010', 'anna.k@example.ca'],
  ],
  it: [
    ['Giulia Rossi', 'Università degli Studi di Torino, Dipartimento di Fisica', 'Professoressa ordinaria', m('연사'), 'A0001', 'giulia.rossi@example.it'],
    ['Marco Bianchi', 'Politecnico di Milano, Ingegneria Meccanica', 'Professore associato', m('좌장'), 'A0002', 'm.bianchi@example.it'],
    ['Chiara Ferrari', 'Università di Bologna', 'Dottoranda', m('학생'), 'A0003', 'chiara.f@example.it'],
    ['Luca Romano', 'LabelTech S.r.l. – Ricerca e Sviluppo', 'Ricercatore senior', m('일반'), 'A0004', 'l.romano@example.com'],
    ['Sara Colombo', 'Università di Padova, Ingegneria Chimica', 'Studentessa magistrale', m('학생'), 'A0005', 'sara.c@example.it'],
    ['Emily Johnson', 'University of California, Berkeley', 'Professor', m('연사'), 'A0006', 'emily@example.edu'],
    ['Alessandro Ricci', 'Università La Sapienza, Facoltà di Medicina, Dipartimento di Scienze Biomediche', 'Ricercatore', m('일반'), 'A0007', 'a.ricci@example.it'],
    ['Francesca Greco', 'Segreteria organizzativa', '', m('스태프'), 'A0008', 'segreteria@example.org'],
    ['Hiroshi Tanaka', 'The University of Tokyo', 'Associate Professor', m('일반'), 'A0009', 'tanaka@example.jp'],
    ['Matteo Conti', 'Università di Firenze', 'Studente triennale', m('학생'), 'A0010', 'matteo.c@example.it'],
  ],
  fr: [
    ['Camille Martin', 'Sorbonne Université, Laboratoire de physique', 'Professeure', m('연사'), 'A0001', 'camille.martin@example.fr'],
    ['Julien Bernard', 'École polytechnique, Département de mécanique', 'Maître de conférences', m('좌장'), 'A0002', 'j.bernard@example.fr'],
    ['Léa Dubois', 'Université de Lyon', 'Doctorante', m('학생'), 'A0003', 'lea.dubois@example.fr'],
    ['Thomas Petit', 'LabelTech SAS – Recherche', 'Ingénieur de recherche', m('일반'), 'A0004', 't.petit@example.com'],
    ['Manon Leroy', 'Université de Strasbourg, Génie chimique', 'Étudiante en master', m('학생'), 'A0005', 'manon.l@example.fr'],
    ['Emily Johnson', 'University of California, Berkeley', 'Professor', m('연사'), 'A0006', 'emily@example.edu'],
    ['Nicolas Moreau', 'Université Paris Cité, Faculté de médecine, Département des sciences biomédicales', 'Chercheur', m('일반'), 'A0007', 'n.moreau@example.fr'],
    ['Sophie Laurent', 'Secrétariat du congrès', '', m('스태프'), 'A0008', 'secretariat@example.org'],
    ['Hiroshi Tanaka', 'The University of Tokyo', 'Associate Professor', m('일반'), 'A0009', 'tanaka@example.jp'],
    ['Hugo Fontaine', 'Université de Bordeaux', 'Étudiant en licence', m('학생'), 'A0010', 'hugo.f@example.fr'],
  ],
});

const attendeeCols = () => [c('이름'), c('소속'), c('직함'), c('참가구분'), 'ID', c('이메일')];
const attendeeTable = () => table(attendeeCols(), attendees().map(([n, a, ti, role, id, mail]) => [n, a, ti, t(role), id, mail]));

/** First sample person of each language, for the address and shipping samples. */
const people = () => pick({
  ko: ['김하늘', '이도윤', '박서연'],
  en: ['Emily Johnson', 'Daniel Okafor', 'Sophie Turner'],
  it: ['Giulia Rossi', 'Marco Bianchi', 'Chiara Ferrari'],
  fr: ['Camille Martin', 'Julien Bernard', 'Léa Dubois'],
});

function badge(paper: Paper): Project {
  const { w: W, h: H } = preprintArea(paper);
  const band = Math.max(7, H * 0.16);
  const objects: LabelObject[] = [
    obj('rect', 0, 0, W, band, { name: t('상단 띠'), fill: solid('#1e3a8a'), strokeWidth: 0, rules: roleRules() }),
    text(3, 0.8, W - 6, band - 1.6, t('2026 추계 학술대회'), { name: t('행사명'), fill: solid('#ffffff'), bold: true, fontSize: 10, align: 'center' }),
    text(4, band + 4, W * 0.66, H * 0.24, f('이름'), {
      name: c('이름'), bold: true, fontSize: 28, minFontSize: 12, rules: [{ column: '', op: 'latin', value: '', set: { fontSize: 20 } }],
    }),
    text(4, band + 4 + H * 0.24, W * 0.66, H * 0.15, f('소속'), { name: c('소속'), fontSize: 11, minFontSize: 6 }),
    text(4, band + 4 + H * 0.39, W * 0.66, H * 0.1, f('직함'), { name: c('직함'), fontSize: 9, fill: solid('#4b5563'), hideIfEmpty: true }),
    obj('qr', W - 4 - H * 0.36, band + 5, H * 0.36, H * 0.36, { name: 'QR', content: '{{ID}}' }),
    text(W - 6 - H * 0.36, band + 5.5 + H * 0.36, H * 0.36 + 4, 4, '{{ID}}', { name: 'ID', fontSize: 7, align: 'center', fill: solid('#4b5563') }),
    obj('rect', 0, H - band, W, band, { name: t('하단 띠'), fill: solid('#1e3a8a'), strokeWidth: 0, rules: roleRules() }),
    text(3, H - band + 0.8, W - 6, band - 1.6, f('참가구분'), { name: c('참가구분'), fill: solid('#ffffff'), bold: true, fontSize: 13, align: 'center' }),
  ];
  return project(paper, t('일반 명찰'), inArea(objects, paper), t('학술대회 명찰'), attendeeTable());
}

/** One look for every attendee: no role column, the footer carries the date and venue. */
function plainBadge(paper: Paper): Project {
  const objects = fitTo([
    obj('rect', 0, 0, 90, 10, { name: t('상단 띠'), fill: solid('#1e3a8a'), strokeWidth: 0 }),
    text(4, 1, 82, 8, t('2026 추계 학술대회'), { name: t('행사명'), fill: solid('#ffffff'), bold: true, fontSize: 11, align: 'center' }),
    text(5, 14, 58, 14, f('이름'), { name: c('이름'), bold: true, fontSize: 28, minFontSize: 12 }),
    text(5, 28.5, 58, 7, f('소속'), { name: c('소속'), fontSize: 11, minFontSize: 6 }),
    text(5, 35.5, 58, 5, f('직함'), { name: c('직함'), fontSize: 9, fill: solid('#4b5563'), hideIfEmpty: true }),
    obj('qr', 67, 14, 18, 18, { name: 'QR', content: '{{ID}}' }),
    text(64, 32.5, 24, 4, '{{ID}}', { name: 'ID', fontSize: 7, align: 'center', fill: solid('#4b5563') }),
    obj('rect', 0, 47, 90, 8, { name: t('하단 띠'), fill: solid('#e0e7ff'), strokeWidth: 0 }),
    text(4, 47.8, 82, 6.4, t('2026. 11. 6.(금) – 7.(토) · 대전컨벤션센터'), { name: t('일시·장소'), fill: solid('#1e3a8a'), fontSize: 9, align: 'center' }),
  ], 90, 55, paper);
  const cols = [c('이름'), c('소속'), c('직함'), 'ID', c('이메일')];
  return project(paper, t('공통 명찰'), objects, t('학술대회 명찰 (공통)'), table(cols, attendees().map(([n, a, ti, , id, mail]) => [n, a, ti, id, mail])));
}

function simpleBadge(paper: Paper): Project {
  const objects = fitTo([
    obj('rect', 0, 0, 3, 55, { name: t('포인트 띠'), fill: solid('#0f766e'), strokeWidth: 0 }),
    text(8, 6, 76, 6, f('소속'), { name: c('소속'), fontSize: 11, minFontSize: 6, fill: solid('#4b5563') }),
    text(8, 15, 76, 20, f('이름'), { name: c('이름'), fontSize: 36, minFontSize: 14, bold: true }),
    obj('line', 8, 38, 74, 1, { name: t('구분선'), stroke: '#0f766e', strokeWidth: 0.4 }),
    text(8, 42, 76, 7, f('직함'), { name: c('직함'), fontSize: 11, hideIfEmpty: true }),
  ], 90, 55, paper);
  return project(paper, t('심플 명찰'), objects, t('심플 명찰'), attendeeTable());
}

function nameTent(paper: Paper): Project {
  const objects = fitTo([
    obj('line', 10, 104.5, 277, 1, { name: t('접는 선'), stroke: '#9ca3af', strokeWidth: 0.3, dash: true }),
    text(20, 22, 257, 50, f('이름'), { name: t('이름(뒤)'), fontSize: 80, minFontSize: 30, bold: true, align: 'center', rotation: 180 }),
    text(20, 72, 257, 20, f('소속'), { name: t('소속(뒤)'), fontSize: 28, minFontSize: 12, align: 'center', rotation: 180 }),
    text(20, 120, 257, 50, f('이름'), { name: c('이름'), fontSize: 80, minFontSize: 30, bold: true, align: 'center' }),
    text(20, 170, 257, 20, f('소속'), { name: c('소속'), fontSize: 28, minFontSize: 12, align: 'center' }),
  ], 297, 210, paper);
  return project(paper, t('네임텐트'), objects, t('테이블 네임텐트'), attendeeTable());
}

function seat(paper: Paper): Project {
  const objects = fitTo([
    text(3, 2, 57.5, 6, t('좌석 번호'), { fontSize: 9, align: 'center', fill: solid('#6b7280') }),
    text(3, 8, 57.5, 22, '{{#seq:000}}', { fontSize: 48, bold: true, align: 'center' }),
  ], 63.5, 33.9, paper);
  return project(paper, t('좌석'), objects, t('좌석·포스터 번호'));
}

function ticket(paper: Paper): Project {
  const objects = fitTo([
    obj('rect', 0, 0, 100, 9, { name: t('상단 띠'), fill: solid('#7c2d12'), strokeWidth: 0 }),
    text(3, 1, 70, 7, f('행사명'), { name: c('행사명'), fontSize: 12, bold: true, fill: solid('#ffffff') }),
    text(3, 12, 70, 6, f('일시'), { name: c('일시'), fontSize: 10 }),
    text(3, 18, 70, 6, f('장소'), { name: c('장소'), fontSize: 10, fill: solid('#4b5563') }),
    text(3, 26, 70, 12, f('좌석'), { name: c('좌석'), fontSize: 24, bold: true }),
    text(3, 41, 70, 6, 'No. {{#seq:00000}}', { name: t('일련번호'), fontSize: 9, fill: solid('#6b7280') }),
    obj('line', 52, 25, 50, 1, { name: t('절취선'), stroke: '#9ca3af', strokeWidth: 0.3, dash: true, rotation: 90 }),
    obj('qr', 80, 14, 17, 17, { name: 'QR', content: `${f('행사명')}-{{#seq:00000}}` }),
    text(77, 34, 23, 12, f('좌석'), { name: t('좌석(절취)'), fontSize: 12, bold: true, align: 'center' }),
  ], 100, 50, paper);
  const [event, when, venue, seats] = pick<[string, string, string, string[]]>({
    ko: ['2026 송년 음악회', '2026.12.19 (토) 19:30', '대강당', ['A열 12번', 'A열 13번', 'B열 1번']],
    en: ['Winter Concert 2026', 'Sat, Dec 19, 2026 · 7:30 PM', 'Main Hall', ['Row A, Seat 12', 'Row A, Seat 13', 'Row B, Seat 1']],
    it: ['Concerto di fine anno 2026', 'Sab 19/12/2026 · ore 19:30', 'Aula Magna', ['Fila A, posto 12', 'Fila A, posto 13', 'Fila B, posto 1']],
    fr: ['Concert de fin d\'année 2026', 'Sam. 19/12/2026 · 19 h 30', 'Grand amphithéâtre', ['Rang A, place 12', 'Rang A, place 13', 'Rang B, place 1']],
  });
  return project(paper, t('입장권'), objects, t('입장권·티켓'), table([c('행사명'), c('일시'), c('장소'), c('좌석')], seats.map((s) => [event, when, venue, s])));
}

/* ---------- 우편·물류 ---------- */

function address(paper: Paper): Project {
  const objects = fitTo([
    text(5, 3, 40, 6, f('우편번호'), { name: c('우편번호'), fontSize: 10, letterSpacing: 0.6 }),
    text(5, 9, 89, 14, f('주소'), { name: c('주소'), fontSize: 12, minFontSize: 6, multiline: true, vAlign: 'top' }),
    text(5, 25, 89, 10, t('{name} 님', { name: f('이름') }), { name: c('이름'), fontSize: 16, bold: true, align: 'right' }),
  ], 99.1, 38.1, paper);
  const addr = pick({
    ko: [['08826', '서울특별시 관악구 관악로 1, 301동 101호'], ['34141', '대전광역시 유성구 대학로 291, 기계공학동 3층'], ['03722', '서울특별시 서대문구 연세로 50']],
    en: [['94720', '110 Sproul Hall, Berkeley, CA'], ['02139', '77 Massachusetts Ave, Cambridge, MA'], ['EH8 9YL', 'Old College, South Bridge, Edinburgh']],
    it: [['10125', 'Via Pietro Giuria 1, Torino (TO)'], ['20133', 'Piazza Leonardo da Vinci 32, Milano (MI)'], ['40126', 'Via Zamboni 33, Bologna (BO)']],
    fr: [['75005', '4 place Jussieu, Paris'], ['91120', 'Route de Saclay, Palaiseau'], ['69007', '15 parvis René Descartes, Lyon']],
  });
  return project(paper, t('주소'), objects, t('주소 라벨'), table([c('우편번호'), c('주소'), c('이름')], addr.map(([zip, a], i) => [zip, a, people()[i]])));
}

function shipping(paper: Paper): Project {
  const objects = fitTo([
    text(5, 4, 90, 8, t('받는 분'), { bold: true, fontSize: 12 }),
    text(5, 13, 90, 10, `${f('받는분')}  ${f('받는분연락처')}`, { fontSize: 16, bold: true }),
    text(5, 24, 90, 22, f('받는주소'), { multiline: true, vAlign: 'top', fontSize: 14 }),
    obj('line', 5, 48, 90, 1, { strokeWidth: 0.4 }),
    text(5, 51, 90, 6, t('보내는 분: {name}  {phone}', { name: f('보내는분'), phone: f('보내는분연락처') }), { fontSize: 10 }),
    text(5, 58, 90, 12, f('보내는주소'), { multiline: true, vAlign: 'top', fontSize: 9, fill: solid('#374151') }),
    obj('line', 5, 73, 90, 1, { strokeWidth: 0.4 }),
    text(5, 77, 60, 7, t('품목: {item}', { item: f('품목') }), { fontSize: 11 }),
    obj('qr', 72, 76, 22, 22, { content: f('운송장번호') }),
    obj('barcode', 8, 105, 84, 30, { content: f('운송장번호'), textSize: 10 }),
  ], 100, 150, paper);
  const p = project(paper, t('택배'), objects, t('택배 송장'));
  const s = pick({
    ko: { phone: (i: number) => '010-0000-000' + i, to: (i: number) => '서울특별시 관악구 관악로 1, 301동 ' + (100 + i) + '호', from: '라벨룸 상사', fromPhone: '02-000-0000', fromAddr: '경기도 성남시 분당구 판교역로 000', items: ['도서', '의류', '전자부품'] },
    en: { phone: (i: number) => '+1 555 010 000' + i, to: (i: number) => `${100 + i} Sproul Hall, Berkeley, CA 94720`, from: 'LabelLoom Supply Co.', fromPhone: '+1 555 010 0000', fromAddr: '500 Market St, San Francisco, CA 94105', items: ['Books', 'Clothing', 'Electronic parts'] },
    it: { phone: (i: number) => '+39 333 000 000' + i, to: (i: number) => `Via Pietro Giuria ${i}, 10125 Torino (TO)`, from: 'LabelLoom S.r.l.', fromPhone: '+39 011 000 0000', fromAddr: 'Corso Vittorio Emanuele II 1, 10123 Torino (TO)', items: ['Libri', 'Abbigliamento', 'Componenti elettronici'] },
    fr: { phone: (i: number) => '+33 6 00 00 00 0' + i, to: (i: number) => `${i} place Jussieu, 75005 Paris`, from: 'LabelLoom SARL', fromPhone: '+33 1 00 00 00 00', fromAddr: '10 rue de Rivoli, 75004 Paris', items: ['Livres', 'Vêtements', 'Composants électroniques'] },
  });
  const cols = [c('운송장번호'), c('받는분'), c('받는분연락처'), c('받는주소'), c('보내는분'), c('보내는분연락처'), c('보내는주소'), c('품목')];
  p.data = table(cols, [1, 2, 3].map((i) => [`52410000${i}234`, people()[i - 1], s.phone(i), s.to(i), s.from, s.fromPhone, s.fromAddr, s.items[i - 1]]));
  return p;
}

/* ---------- 관리·보관 ---------- */

function asset(paper: Paper): Project {
  const objects = fitTo([
    text(2, 1.5, 30, 4.5, t('자산관리 라벨'), { fontSize: 7, bold: true, fill: solid('#1e3a8a') }),
    text(2, 6, 30, 5, f('품명'), { fontSize: 9 }),
    obj('barcode', 2, 11.5, 30, 12, { content: f('자산번호'), textSize: 6 }),
    obj('qr', 34, 4, 12.5, 12.5, { content: f('자산번호') }),
    text(33, 17.5, 14.5, 5, f('부서'), { fontSize: 6, align: 'center' }),
  ], 48.5, 25.4, paper);
  const [items, depts] = pick({
    ko: [['노트북', '모니터', '프린터'], ['연구팀', '총무팀', '개발팀']],
    en: [['Laptop', 'Monitor', 'Printer'], ['Research', 'Admin', 'Engineering']],
    it: [['Portatile', 'Monitor', 'Stampante'], ['Ricerca', 'Amministrazione', 'Sviluppo']],
    fr: [['Ordinateur portable', 'Écran', 'Imprimante'], ['Recherche', 'Services généraux', 'Développement']],
  });
  return project(paper, t('자산'), objects, t('자산관리 라벨'), table([c('자산번호'), c('품명'), c('부서')],
    Array.from({ length: 12 }, (_, i) => [`IT-2026-${String(i + 1).padStart(4, '0')}`, items[i % 3], depts[i % 3]])));
}

function fileLabel(paper: Paper): Project {
  const objects = fitTo([
    obj('rect', 0, 0, 22, 38.1, { name: t('색 띠'), fill: solid('#1d4ed8'), strokeWidth: 0, rules: [
      { column: c('분류'), op: 'eq', value: t('회계'), set: { color: '#b45309' } },
      { column: c('분류'), op: 'eq', value: t('인사'), set: { color: '#be185d' } },
    ] }),
    text(1, 8, 20, 12, f('연도'), { name: c('연도'), fontSize: 18, bold: true, align: 'center', fill: solid('#ffffff') }),
    text(1, 21, 20, 8, f('분류'), { name: c('분류'), fontSize: 10, align: 'center', fill: solid('#ffffff') }),
    text(26, 5, 70, 18, f('제목'), { name: c('제목'), fontSize: 20, minFontSize: 8, bold: true, multiline: true }),
    obj('line', 26, 25, 70, 1, { name: t('구분선'), stroke: '#d1d5db', strokeWidth: 0.3 }),
    text(26, 28, 70, 7, t('{dept} · 보존 {period}', { dept: f('부서'), period: f('보존기간') }), { name: c('부서'), fontSize: 10, fill: solid('#4b5563') }),
  ], 99.1, 38.1, paper);
  // year, category, title, department, retention; the first two categories have colour rules
  return project(paper, t('파일'), objects, t('파일·바인더 라벨'), table([c('연도'), c('분류'), c('제목'), c('부서'), c('보존기간')], pick({
    ko: [['법인카드 영수증 1분기', '총무팀', '5년', '회계'], ['채용 서류', '인사팀', '3년', '인사'], ['연구과제 최종보고서', '연구팀', '영구', '사업']],
    en: [['Corporate card receipts Q1', 'Admin', '5 years', 'Accounting'], ['Recruitment files', 'HR', '3 years', 'HR'], ['Research project final report', 'Research', 'Permanent', 'Projects']],
    it: [['Ricevute carta aziendale 1° trimestre', 'Amministrazione', '5 anni', 'Contabilità'], ['Documenti di selezione', 'Risorse umane', '3 anni', 'Personale'], ['Relazione finale del progetto di ricerca', 'Ricerca', 'Permanente', 'Progetti']],
    fr: [['Reçus carte entreprise T1', 'Services généraux', '5 ans', 'Comptabilité'], ['Dossiers de recrutement', 'Ressources humaines', '3 ans', 'Personnel'], ['Rapport final du projet de recherche', 'Recherche', 'Permanente', 'Projets']],
  }).map(([title, dept, keep, cat], i) => [i === 2 ? '2025' : '2026', i === 0 ? t('회계') : i === 1 ? t('인사') : cat, title, dept, keep])));
}

function food(paper: Paper): Project {
  const objects = fitTo([
    text(3, 2, 54, 9, f('품명'), { name: c('품명'), fontSize: 16, bold: true }),
    obj('line', 3, 11.5, 54, 1, { stroke: '#9ca3af', strokeWidth: 0.3 }),
    text(3, 13.5, 54, 5.5, t('제조일  {date}', { date: pick({ ko: '{{@date:YYYY.MM.DD}}', en: '{{@date:YYYY-MM-DD}}', it: '{{@date:DD/MM/YYYY}}', fr: '{{@date:DD/MM/YYYY}}' }) }), { name: t('제조일'), fontSize: 9 }),
    text(3, 19.5, 54, 6.5, t('소비기한  {date}', { date: f('소비기한') }), { name: c('소비기한'), fontSize: 10, bold: true, fill: solid('#b91c1c') }),
    text(3, 26.5, 54, 5, t('보관  {how}', { how: f('보관방법') }), { name: c('보관방법'), fontSize: 8 }),
    text(3, 32, 54, 6, f('원재료'), { name: c('원재료'), fontSize: 7, minFontSize: 4, multiline: true, fill: solid('#4b5563') }),
  ], 60, 40, paper);
  return project(paper, t('식품'), objects, t('식품·보관 라벨'), table([c('품명'), c('소비기한'), c('보관방법'), c('원재료')], pick({
    ko: [['수제 딸기잼', '2027.04.30', '개봉 후 냉장', '딸기 70%, 설탕, 레몬즙'], ['그래놀라', '2026.12.31', '실온, 직사광선 피함', '귀리, 아몬드, 꿀, 코코넛오일']],
    en: [['Homemade strawberry jam', '2027-04-30', 'Refrigerate after opening', 'Strawberries 70%, sugar, lemon juice'], ['Granola', '2026-12-31', 'Room temperature, away from sunlight', 'Oats, almonds, honey, coconut oil']],
    it: [['Confettura di fragole fatta in casa', '30/04/2027', 'Dopo l\'apertura conservare in frigorifero', 'Fragole 70%, zucchero, succo di limone'], ['Granola', '31/12/2026', 'A temperatura ambiente, lontano dalla luce del sole', 'Avena, mandorle, miele, olio di cocco']],
    fr: [['Confiture de fraises maison', '30/04/2027', 'Au réfrigérateur après ouverture', 'Fraises 70 %, sucre, jus de citron'], ['Granola', '31/12/2026', 'À température ambiante, à l\'abri de la lumière', 'Avoine, amandes, miel, huile de coco']],
  })));
}

function sample(paper: Paper): Project {
  const objects = fitTo([
    obj('qr', 1.5, 2.5, 16, 16, { name: t('데이터매트릭스'), content: f('시료ID'), symbology: 'datamatrix' }),
    text(19, 1.5, 18, 6, f('시료ID'), { name: c('시료ID'), fontSize: 8, bold: true }),
    text(19, 7.5, 18, 5, f('시료명'), { name: c('시료명'), fontSize: 7 }),
    text(19, 12.5, 18, 4, pick({ ko: '{{@date:YY.MM.DD}}', en: '{{@date:YY-MM-DD}}', it: '{{@date:DD/MM/YY}}', fr: '{{@date:DD/MM/YY}}' }), { name: t('날짜'), fontSize: 6, fill: solid('#4b5563') }),
    text(19, 16.5, 18, 4, f('담당자'), { name: c('담당자'), fontSize: 6, fill: solid('#4b5563') }),
  ], 38.1, 21.2, paper);
  const kinds = pick({ ko: ['혈청', '세포 lysate', 'DNA'], en: ['Serum', 'Cell lysate', 'DNA'], it: ['Siero', 'Lisato cellulare', 'DNA'], fr: ['Sérum', 'Lysat cellulaire', 'ADN'] });
  const who = pick({ ko: ['박서연', '정예린'], en: ['Sophie Turner', 'Priya Raman'], it: ['Chiara Ferrari', 'Sara Colombo'], fr: ['Léa Dubois', 'Manon Leroy'] });
  return project(paper, t('시료'), objects, t('시료·튜브 라벨'), table([c('시료ID'), c('시료명'), c('담당자')],
    Array.from({ length: 8 }, (_, i) => [`S26-${String(i + 1).padStart(4, '0')}`, kinds[i % 3], who[i % 2]])));
}

/* ---------- 판매·스티커 ---------- */

function price(paper: Paper): Project {
  const objects = fitTo([
    text(3, 2, 54, 7, f('상품명'), { fontSize: 12, bold: true }),
    text(3, 9, 54, 12, t('{price}원', { price: f('가격') }), { fontSize: 26, bold: true, align: 'right', fill: solid('#b91c1c') }),
    obj('barcode', 3, 22, 54, 16, { content: f('바코드'), symbology: 'ean13', textSize: 7 }),
  ], 60, 40, paper);
  return project(paper, t('가격표'), objects, t('가격표'), table([c('상품명'), c('가격'), c('바코드')], pick({
    ko: [['유기농 녹차 500g', '12,900', '880123456789'], ['현미 2kg', '8,500', '880987654321']],
    en: [['Organic green tea 500 g', '12.90', '880123456789'], ['Brown rice 2 kg', '8.50', '880987654321']],
    it: [['Tè verde biologico 500 g', '12,90', '880123456789'], ['Riso integrale 2 kg', '8,50', '880987654321']],
    fr: [['Thé vert bio 500 g', '12,90', '880123456789'], ['Riz complet 2 kg', '8,50', '880987654321']],
  })));
}

function qrSticker(paper: Paper): Project {
  const objects = fitTo([
    obj('qr', 7.5, 3, 30, 30, { content: '{{URL}}', errorLevel: 'Q' }),
    text(2, 34, 41, 8, f('설명'), { fontSize: 9, align: 'center', bold: true }),
  ], 45, 45, paper);
  return project(paper, 'QR', objects, t('QR 스티커'), table(['URL', c('설명')], [
    ['https://example.com/program', t('프로그램 안내')], ['https://example.com/survey', t('만족도 조사')],
  ]));
}

function roundSticker(paper: Paper): Project {
  const objects = fitTo([
    obj('ellipse', 2, 2, 36, 36, { name: t('테두리'), fill: { type: 'none' }, stroke: '#be185d', strokeWidth: 0.6 }),
    text(6, 9, 28, 6, f('위'), { name: t('윗줄'), fontSize: 8, align: 'center', fill: solid('#be185d') }),
    text(5, 15, 30, 11, f('문구'), { name: c('문구'), fontSize: 18, bold: true, align: 'center' }),
    text(6, 26, 28, 5, f('아래'), { name: t('아랫줄'), fontSize: 7, align: 'center', fill: solid('#4b5563') }),
  ], 40, 40, paper);
  return project(paper, t('원형'), objects, t('원형 스티커'), table([c('위'), c('문구'), c('아래')], [
    ['HANDMADE', t('감사합니다'), 'LabelLoom'], ['SPECIAL', t('선물용'), '2026'],
  ]));
}

function nameSticker(paper: Paper): Project {
  const objects = fitTo([
    obj('ellipse', 2.5, 5, 15, 15, { name: t('원'), fill: solid('#fde68a'), strokeWidth: 0 }),
    text(2.5, 5, 15, 15, f('번호'), { name: c('번호'), fontSize: 14, bold: true, align: 'center' }),
    text(20, 3, 26, 6, f('반'), { name: c('반'), fontSize: 8, fill: solid('#4b5563') }),
    text(20, 9, 26, 13, f('이름'), { name: c('이름'), fontSize: 20, bold: true }),
  ], 48.5, 25.4, paper);
  const cls = t('3학년 2반');
  return project(paper, t('이름'), objects, t('이름 스티커'), table([c('반'), c('번호'), c('이름')], people().map((n, i) => [cls, String(i + 1), n])));
}

/* ---------- registry ---------- */

export interface Template {
  id: string;
  name: () => string;
  desc: () => string;
  /** paper sizes this layout works on; the first is the default */
  papers: Paper[];
  make: (paper: Paper) => Project;
}

const ps = (...names: string[]) => names.map(preset);
const tpl = (id: string, name: Msg, desc: Msg, papers: Paper[], make: (p: Paper) => Project): Template =>
  ({ id, name: () => t(name), desc: () => t(desc), papers, make });

const BADGES = ps(m('A4 명찰 2×5 (90×55)'), m('A4 명찰 2×4 (90×60)'), m('A4 명찰 2×3 (100×70)'), m('명찰 단면 90×55'), m('명찰 100×70'), m('목걸이 명찰 A6 (105×148)'));

export const TEMPLATES: Template[] = [
  tpl('blank', m('빈 라벨'), m('모든 용지 · 처음부터 디자인'), [preset('50×30'), ...PAPER_PRESETS.flatMap((g) => g.items).filter((p) => p.name !== '50×30')], (p) => newProject({ ...p })),
  tpl('badge', m('학술대회 명찰'), m('참가구분별 색 띠 · QR'), BADGES, badge),
  tpl('badge-plain', m('학술대회 명찰 (공통)'), m('역할 구분 없음 · 일시·장소 · QR'), BADGES, plainBadge),
  tpl('badge-simple', m('심플 명찰'), m('소속 · 이름 · 직함'), ps(m('A4 명찰 2×5 (90×55)'), m('A4 명찰 2×4 (90×60)'), m('A4 명찰 2×3 (100×70)'), m('명찰 단면 90×55'), m('명찰 100×70'), 'A4 2×7 (99.1×38.1)', 'Letter 2×5 (101.6×50.8)'), simpleBadge),
  tpl('tent', m('테이블 네임텐트'), m('반 접기 (위쪽 180° 회전)'), ps(m('테이블 네임텐트 (A4 가로)'), m('테이블 네임텐트 (Letter 가로)')), nameTent),
  tpl('ticket', m('입장권·티켓'), m('일련번호 · 절취선 · QR'), ps('100×50', m('A4 명찰 2×5 (90×55)'), 'Letter 2×5 (101.6×50.8)', 'A4 2×7 (99.1×38.1)'), ticket),
  tpl('seat', m('좌석·포스터 번호'), m('일련번호'), ps('A4 3×8 (63.5×33.9)', 'A4 3×7 (63.5×38.1)', 'A4 2×7 (99.1×38.1)', 'A4 2×8 (99.1×33.9)', 'A4 4×10 (48.5×25.4)', '50×30', '60×40', 'Letter 3×10 (66.7×25.4)'), seat),
  tpl('address', m('주소 라벨'), m('우편번호 · 주소 · 받는 분'), ps('A4 2×7 (99.1×38.1)', 'A4 2×8 (99.1×33.9)', 'A4 3×7 (63.5×38.1)', 'A4 3×8 (63.5×33.9)', 'Letter 3×10 (66.7×25.4)', 'Letter 2×5 (101.6×50.8)', '100×50'), address),
  tpl('ship', m('택배 송장'), m('Code128 + QR'), ps(m('택배 100×150'), 'A4 2×2 (105×148.5)', m('목걸이 명찰 A6 (105×148)')), shipping),
  tpl('file', m('파일·바인더 라벨'), m('분류별 색 띠 · 보존기간'), ps('A4 2×7 (99.1×38.1)', 'A4 2×8 (99.1×33.9)', 'Letter 2×5 (101.6×50.8)', '100×50', 'A4 3×7 (63.5×38.1)'), fileLabel),
  tpl('asset', m('자산관리 라벨'), m('바코드 + QR'), ps('A4 4×10 (48.5×25.4)', 'A4 5×13 (38.1×21.2)', 'A4 3×8 (63.5×33.9)', '50×30', '40×20', '60×40', 'Letter 3×10 (66.7×25.4)'), asset),
  tpl('sample', m('시료·튜브 라벨'), m('DataMatrix · 날짜 · 담당자'), ps('A4 5×13 (38.1×21.2)', '40×20', '30×20', 'A4 4×10 (48.5×25.4)', '50×30'), sample),
  tpl('food', m('식품·보관 라벨'), m('제조일(오늘) · 소비기한 · 원재료'), ps('60×40', '50×30', 'A4 3×7 (63.5×38.1)', 'A4 3×8 (63.5×33.9)', 'A4 4×10 (48.5×25.4)', '100×50'), food),
  tpl('price', m('가격표'), m('EAN-13 바코드'), ps('60×40', '50×30', '40×20', 'A4 3×7 (63.5×38.1)', 'A4 4×10 (48.5×25.4)'), price),
  tpl('qr', m('QR 스티커'), m('QR + 설명'), ps('A4 4×6 (45×45)', m('정사각 40×40'), 'A4 3×7 (63.5×38.1)', '60×40'), qrSticker),
  tpl('round', m('원형 스티커'), m('포장·감사 스티커'), ps(m('A4 원형 4×6 (Ø40)'), m('A4 원형 3×4 (Ø60)'), m('원형 Ø40'), m('정사각 40×40'), 'A4 4×6 (45×45)'), roundSticker),
  tpl('name', m('이름 스티커'), m('학용품 · 반 · 번호'), ps('A4 4×10 (48.5×25.4)', 'A4 5×13 (38.1×21.2)', 'A4 3×8 (63.5×33.9)', '50×30', '40×20', 'Letter 3×10 (66.7×25.4)'), nameSticker),
];
