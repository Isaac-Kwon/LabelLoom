import { getLang, m, t, type Msg } from '../i18n';
import { pushRecent } from '../io/project';
import { newObject, newProject, uid } from '../model/defaults';
import { preset } from '../model/presets';
import { TEMPLATES } from '../model/templates';
import type { LabelObject, Project, TextObj } from '../model/types';
import { useStore } from '../store';

/*
 * Tutorial lessons. One list feeds the example projects (start dialog), the help dialog and
 * the guided tour, so the three never drift apart. The web pages in docs/tutorial/ follow
 * the same lessons and step order.
 */

type State = ReturnType<typeof useStore.getState>;

export interface Step {
  /** data-tour attribute of the element to point at; none = a card in the middle */
  target?: string;
  text: Msg;
  /** {placeholders} in text, filled when shown */
  vars?: () => Record<string, string>;
  /** the tour moves on by itself once this holds; without it the step waits for 다음 */
  done?: (s: State) => boolean;
}

export interface Lesson {
  id: string;
  title: Msg;
  summary: Msg;
  /** page in docs/tutorial/ */
  doc: string;
  make: () => Project;
  steps: Step[];
}

export const stepText = (st: Step) => t(st.text, st.vars?.());

/** Objects of the shown design and side. */
const objects = (s: State): LabelObject[] => {
  const d = s.project.designs.find((x) => x.id === s.designId) ?? s.project.designs[0];
  return (s.side === 'back' ? d.back : d.objects) ?? [];
};
const count = (s: State, f: (o: LabelObject) => boolean) => objects(s).filter(f).length;
const selected = (s: State, f: (o: LabelObject) => boolean) => objects(s).some((o) => s.selection.includes(o.id) && f(o));
const isShape = (o: LabelObject) => o.type === 'rect' || o.type === 'ellipse' || o.type === 'triangle' || o.type === 'line';
const isShapeTool = (s: State) => s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'triangle' || s.tool === 'line';
const texts = (s: State) => count(s, (o) => o.type === 'text' && !o.noPrint);
const qrs = (s: State) => count(s, (o) => o.type === 'qr');
const bound = (o: LabelObject) => 'content' in o && /\{\{/.test(o.content);

const fromTemplate = (id: string, name: string): Project => {
  const tpl = TEMPLATES.find((x) => x.id === id)!;
  return { ...tpl.make(tpl.papers[0]), name };
};

function firstLabel(): Project {
  const p = newProject(preset('50×30'), undefined, t('튜토리얼 · 첫 라벨'));
  const guide: TextObj = {
    ...(newObject('text', 2, 2, 46, 26) as TextObj), name: t('안내'), content: t('이 회색 글자는 인쇄되지 않는 안내입니다.\n텍스트 도구로 글자를 넣어 보세요.'),
    fontSize: 8, minFontSize: 5, multiline: true, align: 'center', fill: { type: 'solid', color: '#9ca3af' }, noPrint: true,
  };
  p.designs[0].objects = [guide];
  return p;
}

/** Conference badge with a second design for speakers, picked by a design rule. */
function eventBadge(): Project {
  const p = fromTemplate('badge', t('튜토리얼 · 행사 명찰'));
  const base = p.designs[0];
  const event = t('2026 추계 학술대회');
  const speaker = {
    id: uid(), name: t('연사 명찰'),
    objects: base.objects.map((o) => ({ ...o, id: uid(), ...(o.type === 'text' && o.content === event ? { content: `${event} · ${t('초청 연사')}` } : {}) }) as LabelObject),
  };
  p.designs = [base, speaker];
  p.designRules = [{ column: t('참가구분'), op: 'eq', value: t('연사'), designId: speaker.id }];
  return p;
}

export const LESSONS: Lesson[] = [
  {
    id: 'first', title: m('첫 라벨 만들기'), summary: m('글자·도형 넣기 → 모양 다듬기 → 인쇄'), doc: '01-first-label.md',
    make: firstLabel,
    steps: [
      { text: m('50×30 mm 빈 라벨을 열었습니다. 글자와 도형을 넣고 다듬은 뒤 인쇄까지 해 봅니다.') },
      { target: 'tool-text', text: m('도구 막대에서 텍스트(T)를 누르세요. 도구를 고르기만 해서는 아무것도 생기지 않습니다.'), done: (s) => s.tool === 'text' || texts(s) > 0 },
      { target: 'canvas', text: m('이제 가운데 편집 화면의 라벨 위를 클릭하세요. 그 자리에 글상자가 생기고 바로 글자를 입력할 수 있습니다. 마우스를 누른 채 끌면 끈 크기만큼 글상자가 생깁니다.'), done: (s) => texts(s) > 0 },
      { target: 'inspector', text: m('오른쪽 속성 패널에서 내용, 글꼴 크기, 굵게, 정렬을 바꿔 보세요. 캔버스에서 글상자를 더블클릭해도 내용을 고칠 수 있습니다.') },
      { target: 'tool-rect', text: m('이번에는 도형입니다. 도구 막대에서 사각형(R)이나 선(L)을 누르세요.'), done: (s) => isShapeTool(s) || count(s, isShape) > 0 },
      { target: 'canvas', text: m('가운데 편집 화면에서 마우스를 누른 채 대각선으로 끌어 사각형을 그리세요. 선은 시작점에서 끝점까지 끕니다. 클릭만 하면 기본 크기로 생깁니다. 그린 뒤에는 끌어서 옮기고, 모서리 핸들로 크기를 바꿉니다.'), done: (s) => count(s, isShape) > 0 },
      { target: 'canvas', text: m('Shift+클릭으로 개체를 여러 개 고르면 속성 패널에 정렬·분배 버튼이 나옵니다. 방향키는 0.5 mm, Shift+방향키는 5 mm씩 옮깁니다.') },
      { target: 'undo', text: m('실수했으면 실행 취소(Ctrl+Z)를 누르세요. 작업은 브라우저에 자동 저장되고, 파일로 남기려면 파일 › 저장(Ctrl+S)을 씁니다.') },
      { target: 'tab-paper', text: m('용지 탭에서 라벨 크기, 한 장의 칸 수, 여백을 바꿉니다. 시판 라벨지는 새로 만들기의 기성 라벨 용지 탭에서 고를 수 있습니다.') },
      { target: 'export', text: m('인쇄 · 내보내기(Ctrl+P)를 누르세요.'), done: (s) => s.dialog === 'export' },
      { target: 'export-format', text: m('브라우저 인쇄, PDF, PNG 중에서 고릅니다. 브라우저 인쇄 창에서는 배율을 100%(실제 크기)로 두세요. 회색 안내 글자는 인쇄되지 않습니다.') },
    ],
  },
  {
    id: 'list', title: m('명단으로 대량 인쇄'), summary: m('엑셀 명단 → {{열 이름}} 연결 → 미출력만 인쇄'), doc: '02-mail-merge.md',
    make: () => fromTemplate('badge-simple', t('튜토리얼 · 명단 명찰')),
    steps: [
      { text: m('명찰 디자인과 참가자 명단 10행을 열었습니다. 명단의 값이 행마다 명찰에 들어갑니다.') },
      { target: 'data', text: m('아래 데이터 표가 명단입니다. 셀을 눌러 바로 고칠 수 있고, 행마다 인쇄 여부와 매수를 정합니다.') },
      { target: 'import', text: m('가지고 있는 명단은 가져오기(xlsx·csv)로 불러옵니다. 첫 행이 열 이름이어야 하며, 파일을 화면에 끌어다 놓아도 됩니다.') },
      { target: 'canvas', text: m('캔버스에서 이름 글상자를 클릭하세요.'), done: (s) => selected(s, bound) },
      { target: 'content', text: m('{code}처럼 중괄호 두 쌍으로 감싼 열 이름이 그 행의 값으로 바뀝니다. 목록에서 열을 골라 넣을 수 있고, 아래에 현재 행의 값이 보입니다.'), vars: () => ({ code: `{{${t('이름')}}}` }) },
      { target: 'row-nav', text: m('◀ ▶ 또는 PageUp/PageDown으로 다른 행을 미리 보세요.'), done: (s) => s.currentRow > 0 },
      { target: 'export', text: m('인쇄 · 내보내기를 여세요.'), done: (s) => s.dialog === 'export' },
      { target: 'export-scope', text: m('대상에서 인쇄 체크된 행, 아직 출력 안 한 행, 필터 결과, 행 범위 중에서 고릅니다. 출력하면 행마다 시각이 기록되어, 다음에는 출력 안 한 행만 뽑을 수 있습니다.') },
      { target: 'data', text: m('출력 열에 출력 시각이 남습니다. 데이터의 내보내기로 인쇄 기록이 든 xlsx를 받을 수 있습니다.') },
    ],
  },
  {
    id: 'codes', title: m('바코드·QR·일련번호'), summary: m('바코드 종류 → QR 추가 → 일련번호와 날짜'), doc: '03-codes.md',
    make: () => fromTemplate('asset', t('튜토리얼 · 자산 라벨')),
    steps: [
      { text: m('자산관리 라벨을 열었습니다. 바코드와 QR이 자산번호 열의 값을 담습니다.') },
      { target: 'canvas', text: m('캔버스에서 바코드를 클릭하세요.'), done: (s) => selected(s, (o) => o.type === 'barcode') },
      { target: 'barcode', text: m('종류에서 Code128, EAN-13 같은 규격을 고릅니다. 값이 규격에 맞지 않거나 막대가 너무 가늘면 경고가 나옵니다.') },
      { target: 'tool-qr', text: m('QR 코드를 하나 더 넣어 봅니다. 도구 막대에서 QR 코드(Q)를 누르세요.'), done: (s) => s.tool === 'qr' || qrs(s) > 1 },
      { target: 'canvas', text: m('가운데 편집 화면에서 라벨의 빈 곳을 클릭하거나, 마우스를 누른 채 끌어 QR 코드를 넣으세요.'), done: (s) => qrs(s) > 1 },
      { target: 'content', text: m('내용에 URL이나 {{열 이름}}을 넣습니다. 서식 요소 목록에서 일련번호({{#seq:0000}})나 오늘 날짜({{@date:YYYY-MM-DD}})도 넣을 수 있습니다.') },
      { target: 'serial', text: m('명단이 없어도 일련번호 생성으로 번호 열을 만들 수 있습니다. 눌러 보세요.'), done: (s) => s.dialog === 'serial' },
      { text: m('시작 번호, 증감, 자릿수, 접두·접미를 정하고 적용하면 데이터 표에 번호 열이 생깁니다. 그 열을 바코드 내용에 넣으면 라벨마다 다른 바코드가 나옵니다.') },
    ],
  },
  {
    id: 'event', title: m('행사 현장 운영'), summary: m('조건부 스타일 · 디자인 자동 선택 · 보정 · 현장 재발행'), doc: '04-event.md',
    make: eventBadge,
    steps: [
      { text: m('학술대회 명찰과 참가자 10명을 열었습니다. 참가구분에 따라 색과 디자인이 바뀌도록 설정되어 있습니다.') },
      { target: 'canvas', text: m('명찰 위쪽이나 아래쪽 색 띠를 클릭하세요.'), done: (s) => selected(s, (o) => o.rules.length > 0) },
      { target: 'rules', text: m('조건부 스타일: 참가구분 = 연사이면 빨간색처럼, 행의 값에 따라 색·글자 크기·숨김을 바꿉니다. ＋로 규칙을 더합니다.') },
      { target: 'row-nav', text: m('행을 넘겨 보세요. 참가구분마다 띠 색이 바뀝니다.'), done: (s) => s.currentRow > 0 },
      { target: 'tab-designs', text: m('디자인 탭에서는 한 프로젝트에 디자인을 여러 개 두고, 행의 값으로 출력할 디자인을 고릅니다. 이 예제는 연사에게 "연사 명찰"을 씁니다.') },
      { target: 'file-menu', text: m('행사 전에 파일 › 프린터 정렬 보정에서 테스트 페이지를 인쇄하고, 어긋난 만큼 X/Y 오프셋을 맞추세요.') },
      { target: 'reprint', text: m('현장에서는 현장 재발행으로 이름을 검색해 1장만 바로 인쇄합니다. 새로 온 참가자는 추가하자마자 인쇄합니다.'), done: (s) => s.dialog === 'reprint' },
      { target: 'quick', text: m('빠른 출력은 편집기 없이 값 입력 → 미리보기 → 인쇄만 하는 화면입니다. 접수대 PC에 띄워 두기 좋습니다.') },
    ],
  },
];

/** The lesson's example project; the work it replaces goes to the recent list unless it is empty. */
export function lessonProject(l: Lesson): Project {
  const cur = useStore.getState().project;
  if (cur.data.rows.length || cur.designs.some((d) => d.objects.length || d.back?.length)) void pushRecent(cur);
  return l.make();
}

const DOCS = 'https://github.com/Isaac-Kwon/LabelLoom/blob/main/docs/tutorial/';
/** Web page of a lesson (or the tutorial index): Korean, or English for every other language. */
export const docUrl = (l?: Lesson) => DOCS + (getLang() === 'ko' ? '' : 'en/') + (l?.doc ?? 'README.md');
