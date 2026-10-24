import { useEffect, useMemo, useRef, useState } from 'react';
import { readAsDataURL, pickFile } from '../io/project';
import { COMMON_FONTS } from '../io/fonts';
import { TYPE_LABEL } from '../model/defaults';
import type { BarcodeObj, Effects, Fill, LabelObject, ObjType, QrObj, ShapeObj, StyleRule, TextObj } from '../model/types';
import { barcodeSvg, code2dSvg, CODES_2D, moduleSizeMm, SYMBOLOGIES } from '../render/barcode';
import { previewCtx, resolveObject, RULE_OPS } from '../render/resolve';
import { act, currentObjects, useStore } from '../store';
import { Check, Color, Num, Row, Section, Select, Seg } from './controls';
import { pickImageInto } from './media';
import { align, convert, distribute, extendToBleed, group, matchSize, reorder, ungroup } from './ops';
import { TableSection } from './TableEditor';

export function Inspector() {
  const project = useStore((s) => s.project);
  const designId = useStore((s) => s.designId);
  const side = useStore((s) => s.side);
  const selection = useStore((s) => s.selection);
  const objects = currentObjects({ project, designId, side });
  const sel = objects.filter((o) => selection.includes(o.id));

  if (!sel.length) return <EmptyInspector />;
  return (
    <div className="inspector">
      <Section title={sel.length > 1 ? `${sel.length}개 선택 · 정렬` : `${TYPE_LABEL[sel[0].type]} · 정렬`}>
        <AlignBar count={sel.length} />
      </Section>
      {sel.length === 1 ? <Single o={sel[0]} /> : <Multi objs={sel} />}
    </div>
  );
}

function EmptyInspector() {
  const p = useStore((s) => s.project.paper);
  return (
    <div className="inspector empty">
      <p className="muted">개체를 선택하면 속성이 표시됩니다.</p>
      <p className="muted small">라벨 {p.labelWidth}×{p.labelHeight} mm · 용지 {p.width}×{p.height} mm · {p.cols}×{p.rows}칸</p>
      <ul className="tips">
        <li>상단 도구로 개체를 그린 뒤 끌어서 배치합니다.</li>
        <li>내용에 <code>{'{{열 이름}}'}</code>을 넣으면 데이터 행 값으로 바뀝니다.</li>
        <li><kbd>Shift</kbd> 드래그: 수평/수직 이동 · <kbd>Alt</kbd>: 스냅 끄기</li>
        <li><kbd>Space</kbd>+드래그 또는 휠: 화면 이동 · <kbd>Ctrl</kbd>+휠: 확대</li>
        <li><kbd>?</kbd> 단축키 목록</li>
      </ul>
    </div>
  );
}

function AlignBar({ count }: { count: number }) {
  return (
    <>
      <div className="btn-row">
        <button className="icon" title="왼쪽 맞춤" onClick={() => align('left')}>⫷</button>
        <button className="icon" title="가로 가운데" onClick={() => align('hcenter')}>⫿</button>
        <button className="icon" title="오른쪽 맞춤" onClick={() => align('right')}>⫸</button>
        <button className="icon" title="위쪽 맞춤" onClick={() => align('top')}>⊤</button>
        <button className="icon" title="세로 가운데" onClick={() => align('vcenter')}>⊝</button>
        <button className="icon" title="아래쪽 맞춤" onClick={() => align('bottom')}>⊥</button>
      </div>
      <div className="btn-row">
        {count >= 3 && <button onClick={() => distribute('h')} title="가로 간격 같게">가로 분배</button>}
        {count >= 3 && <button onClick={() => distribute('v')} title="세로 간격 같게">세로 분배</button>}
        {count >= 2 && <button onClick={() => matchSize('w')} title="첫 개체 폭에 맞춤">폭 맞춤</button>}
        {count >= 2 && <button onClick={() => matchSize('h')} title="첫 개체 높이에 맞춤">높이 맞춤</button>}
      </div>
      <div className="btn-row">
        <button onClick={() => reorder('front')} title="맨 앞으로 (Ctrl+Shift+])">맨 앞</button>
        <button onClick={() => reorder('forward')} title="앞으로 (Ctrl+])">앞으로</button>
        <button onClick={() => reorder('backward')} title="뒤로 (Ctrl+[)">뒤로</button>
        <button onClick={() => reorder('back')} title="맨 뒤로 (Ctrl+Shift+[)">맨 뒤</button>
      </div>
      {count >= 2 && <div className="btn-row"><button onClick={group}>그룹 (Ctrl+G)</button><button onClick={ungroup}>그룹 해제</button></div>}
    </>
  );
}

function Multi({ objs }: { objs: LabelObject[] }) {
  const ids = objs.map((o) => o.id);
  const allLocked = objs.every((o) => o.locked);
  return (
    <Section title="공통">
      <Row label="불투명도"><Num value={objs[0].opacity * 100} step={5} min={0} max={100} unit="%" onChange={(v) => act.update(ids, { opacity: v / 100 })} /></Row>
      <Row><Check label="잠금" checked={allLocked} onChange={(v) => act.update(ids, { locked: v })} /></Row>
      <Row><Check label="인쇄 안 함 (안내용)" title={NO_PRINT_HINT} checked={objs.every((o) => o.noPrint)} onChange={(v) => act.update(ids, { noPrint: v })} /></Row>
      <BleedButton />
    </Section>
  );
}

function BleedButton() {
  const bleed = useStore((s) => s.project.paper.bleed);
  return (
    <Row>
      <button onClick={extendToBleed} title={bleed > 0
        ? `라벨 가장자리에 닿은 변을 재단선 밖 ${bleed} mm까지 늘립니다. 가장자리에 닿지 않으면 라벨 전체 + 재단 여백을 채웁니다.`
        : '용지 설정에서 재단 여백(블리드)을 먼저 정하세요.'}>
        ⤢ 재단 여백까지 늘리기{bleed > 0 ? ` (${bleed} mm)` : ''}
      </button>
    </Row>
  );
}

const NO_PRINT_HINT = '라벨지에 이미 인쇄된 그림의 자리를 표시할 때 씁니다. 화면에는 보라색 점선과 함께 보이고 인쇄·PDF·PNG에서는 빠집니다.';

function Single({ o }: { o: LabelObject }) {
  const up = (patch: Partial<LabelObject>) => act.update([o.id], patch);
  return (
    <>
      <Section title="개체">
        <Row label="이름"><input type="text" value={o.name} onChange={(e) => up({ name: e.target.value })} /></Row>
        <Row label="종류">
          <Select value={o.type} onChange={(t: ObjType) => act.editObjects((list) => list.map((x) => (x.id === o.id ? convert(x, t) : x)))}
            options={(Object.keys(TYPE_LABEL) as ObjType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} title="개체 종류 변환" />
        </Row>
        <Row>
          <Check label="잠금" checked={o.locked} onChange={(v) => up({ locked: v })} />
          <Check label="숨김" checked={o.hidden} onChange={(v) => up({ hidden: v })} />
        </Row>
        <Row><Check label="인쇄 안 함 (안내용)" title={NO_PRINT_HINT} checked={!!o.noPrint} onChange={(v) => up({ noPrint: v })} /></Row>
      </Section>
      <Section title="위치·크기 (mm)">
        <div className="grid2">
          <Num label="X" value={o.x} step={0.1} onChange={(v) => up({ x: v })} />
          <Num label="Y" value={o.y} step={0.1} onChange={(v) => up({ y: v })} />
          <Num label="W" value={o.w} step={0.1} min={0.2} onChange={(v) => up({ w: v })} />
          <Num label="H" value={o.h} step={0.1} min={0.2} onChange={(v) => up({ h: v })} />
          <Num label="회전" value={o.rotation} step={1} unit="°" onChange={(v) => up({ rotation: ((v % 360) + 360) % 360 })} />
          <Num label="불투명" value={Math.round(o.opacity * 100)} step={5} min={0} max={100} unit="%" onChange={(v) => up({ opacity: v / 100 })} />
        </div>
        <BleedButton />
      </Section>
      {'content' in o && <ContentSection o={o} />}
      {o.type === 'text' && <TextSection o={o} />}
      {(o.type === 'rect' || o.type === 'ellipse' || o.type === 'triangle' || o.type === 'line') && <ShapeSection o={o} />}
      {o.type === 'barcode' && <BarcodeSection o={o} />}
      {o.type === 'qr' && <QrSection o={o} />}
      {o.type === 'table' && <TableSection o={o} />}
      {(o.type === 'image' || o.type === 'svg') && (
        <Section title={o.type === 'image' ? '이미지' : 'SVG'}>
          <Row><button onClick={() => pickImageInto(o.id, o.type as 'image' | 'svg')}>파일 선택…</button></Row>
          <Row label="맞춤">
            <Select value={o.fit} onChange={(v) => up({ fit: v } as Partial<LabelObject>)}
              options={o.type === 'image' ? [{ value: 'contain', label: '비율 유지 (맞춤)' }, { value: 'cover', label: '비율 유지 (채움)' }, { value: 'stretch', label: '늘이기' }] : [{ value: 'contain', label: '비율 유지' }, { value: 'stretch', label: '늘이기' }]} />
          </Row>
        </Section>
      )}
      {'effects' in o && <EffectsSection o={o} />}
      <RulesSection o={o} />
    </>
  );
}

/* ---------- content / binding ---------- */

const TOKENS = [
  { v: '{{#seq}}', l: '일련번호 (인쇄 순서)' }, { v: '{{#seq:0000}}', l: '일련번호 4자리 (0001)' },
  { v: '{{#row}}', l: '행 번호' }, { v: '{{#copy}}', l: '매수 번호' }, { v: '{{#page}}', l: '페이지 번호' },
  { v: '{{@date:YYYY-MM-DD}}', l: '날짜' }, { v: '{{@time:HH:mm}}', l: '시간' }, { v: '{{@date:YYYY.MM.DD HH:mm}}', l: '날짜+시간' },
  { v: '\n', l: '줄바꿈' }, { v: '{{^GS}}', l: 'GS 제어문자 (GS1)' }, { v: '{{^TAB}}', l: 'TAB' },
  { v: '(01)', l: 'GS1 (01) GTIN' }, { v: '(10)', l: 'GS1 (10) LOT' }, { v: '(17)', l: 'GS1 (17) 유통기한' }, { v: '(21)', l: 'GS1 (21) 일련번호' },
];

function ContentSection({ o }: { o: TextObj | BarcodeObj | QrObj }) {
  const project = useStore((s) => s.project);
  const currentRow = useStore((s) => s.currentRow);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const h = () => { ref.current?.focus(); ref.current?.select(); };
    window.addEventListener('labelloom:focus-content', h);
    return () => window.removeEventListener('labelloom:focus-content', h);
  }, []);
  const insert = (tok: string) => {
    const ta = ref.current;
    const s = ta?.selectionStart ?? o.content.length, e = ta?.selectionEnd ?? o.content.length;
    act.update([o.id], { content: o.content.slice(0, s) + tok + o.content.slice(e) } as Partial<LabelObject>);
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(s + tok.length, s + tok.length); }, 0);
  };
  const row = project.data.rows[currentRow];
  const resolved = resolveObject(o, previewCtx(row, currentRow, project.seqStart)).content;
  return (
    <Section title="내용 · 데이터 연결">
      <textarea ref={ref} className="content" rows={o.type === 'text' && o.multiline ? 4 : 2} value={o.content}
        onChange={(e) => act.update([o.id], { content: e.target.value } as Partial<LabelObject>)} spellCheck={false} />
      <div className="btn-row">
        <select value="" onChange={(e) => e.target.value && insert(`{{${e.target.value}}}`)} title="데이터 열 삽입">
          <option value="">+ 데이터 열</option>
          {project.data.columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value="" onChange={(e) => e.target.value && insert(e.target.value)} title="서식 요소 삽입">
          <option value="">+ 서식 요소</option>
          {TOKENS.map((t) => <option key={t.l} value={t.v}>{t.l}</option>)}
        </select>
      </div>
      <div className="preview-value" title="현재 행으로 계산된 값">{resolved ? resolved.replace(/[\x00-\x1f]/g, (c) => (c === '\n' ? '↵' : '·')) : <span className="muted">(빈 값)</span>}</div>
      <Check label="값이 비면 숨김" checked={o.hideIfEmpty} onChange={(v) => act.update([o.id], { hideIfEmpty: v })} />
    </Section>
  );
}

/* ---------- text ---------- */

function useFontList() {
  const fonts = useStore((s) => s.project.fonts);
  const [local, setLocal] = useState<string[]>(() => (window as unknown as { __localFonts?: string[] }).__localFonts ?? []);
  useEffect(() => {
    const h = () => setLocal((window as unknown as { __localFonts?: string[] }).__localFonts ?? []);
    window.addEventListener('labelloom:fonts', h);
    return () => window.removeEventListener('labelloom:fonts', h);
  }, []);
  return useMemo(() => [...new Set([...fonts.map((f) => f.family), ...COMMON_FONTS, ...local])], [fonts, local]);
}

const quoteFamily = (f: string) => (/^[\w-]+$/.test(f) ? f : `"${f}"`);
const primaryFamily = (css: string) => css.split(',')[0].trim().replace(/^["']|["']$/g, '');

function TextSection({ o }: { o: TextObj }) {
  const up = (p: Partial<TextObj>) => act.update([o.id], p as Partial<LabelObject>);
  const fonts = useFontList();
  return (
    <Section title="텍스트">
      <Row label="글꼴">
        <input list="font-list" value={primaryFamily(o.fontFamily)} onChange={(e) => up({ fontFamily: `${quoteFamily(e.target.value)}, "Malgun Gothic", sans-serif` })} />
        <datalist id="font-list">{fonts.map((f) => <option key={f} value={f} />)}</datalist>
      </Row>
      <div className="grid2">
        <Num label="크기" value={o.fontSize} step={0.5} min={1} unit="pt" onChange={(v) => up({ fontSize: v })} />
        <Num label="최소" value={o.minFontSize} step={0.5} min={1} unit="pt" title="자동 축소 최소 크기" onChange={(v) => up({ minFontSize: v })} />
        <Num label="자간" value={o.letterSpacing} step={0.1} unit="mm" onChange={(v) => up({ letterSpacing: v })} />
        <Num label="행간" value={o.lineHeight} step={0.05} min={0.5} unit="×" onChange={(v) => up({ lineHeight: v })} />
      </div>
      <Row>
        <Seg value={o.bold ? 'b' : ''} onChange={() => up({ bold: !o.bold })} options={[{ value: 'b', label: <b>B</b>, title: '굵게' }]} />
        <Seg value={o.italic ? 'i' : ''} onChange={() => up({ italic: !o.italic })} options={[{ value: 'i', label: <i>I</i>, title: '기울임' }]} />
        <Seg value={o.underline ? 'u' : ''} onChange={() => up({ underline: !o.underline })} options={[{ value: 'u', label: <u>U</u>, title: '밑줄' }]} />
        <Seg value={o.align} onChange={(v) => up({ align: v })} options={[{ value: 'left', label: '⇤', title: '왼쪽' }, { value: 'center', label: '↔', title: '가운데' }, { value: 'right', label: '⇥', title: '오른쪽' }]} />
        <Seg value={o.vAlign} onChange={(v) => up({ vAlign: v })} options={[{ value: 'top', label: '⤒', title: '위' }, { value: 'middle', label: '⇕', title: '가운데' }, { value: 'bottom', label: '⤓', title: '아래' }]} />
      </Row>
      <Row label="줄">
        <Seg value={o.multiline ? 'm' : 's'} onChange={(v) => up({ multiline: v === 'm' })} options={[{ value: 's', label: '한 줄' }, { value: 'm', label: '여러 줄' }]} />
      </Row>
      <Row label="맞춤">
        <Select value={o.fit} onChange={(v) => up({ fit: v })} options={[
          { value: 'shrink', label: '자동 축소 (상자에 맞춤)' },
          { value: 'stretch', label: '장평 조절 (한 줄 폭 맞춤)' },
          { value: 'none', label: '고정 크기' },
        ]} />
      </Row>
      <Check label="넘치면 말줄임(…)" checked={o.ellipsis} onChange={(v) => up({ ellipsis: v })} />
      <FillEditor label="글자색" fill={o.fill} onChange={(fill) => up({ fill })} allowNone={false} />
    </Section>
  );
}

export function FillEditor({ label, fill, onChange, allowNone = true }: { label: string; fill: Fill; onChange: (f: Fill) => void; allowNone?: boolean }) {
  const first = fill.type === 'solid' ? fill.color : fill.type === 'none' ? '#ffffff' : fill.stops[0]?.color ?? '#ffffff';
  const second = fill.type === 'linear' || fill.type === 'radial' ? fill.stops[fill.stops.length - 1]?.color ?? '#000000' : '#1e3a8a';
  const opts = [
    ...(allowNone ? [{ value: 'none' as const, label: '없음' }] : []),
    { value: 'solid' as const, label: '단색' }, { value: 'linear' as const, label: '선형' }, { value: 'radial' as const, label: '원형' },
  ];
  const setType = (t: Fill['type']) => {
    if (t === 'none') onChange({ type: 'none' });
    else if (t === 'solid') onChange({ type: 'solid', color: first });
    else if (t === 'linear') onChange({ type: 'linear', angle: 0, stops: [{ offset: 0, color: first }, { offset: 1, color: second }] });
    else onChange({ type: 'radial', stops: [{ offset: 0, color: first }, { offset: 1, color: second }] });
  };
  return (
    <div className="fill-editor">
      <Row label={label}><Seg value={fill.type} onChange={setType} options={opts} /></Row>
      {fill.type === 'solid' && <Row><Color value={fill.color} onChange={(c) => onChange({ type: 'solid', color: c })} /></Row>}
      {(fill.type === 'linear' || fill.type === 'radial') && (
        <>
          <Row><Color value={fill.stops[0].color} onChange={(c) => onChange({ ...fill, stops: [{ offset: 0, color: c }, fill.stops[fill.stops.length - 1]] })} /></Row>
          <Row><Color value={fill.stops[fill.stops.length - 1].color} onChange={(c) => onChange({ ...fill, stops: [fill.stops[0], { offset: 1, color: c }] })} /></Row>
          {fill.type === 'linear' && <Row label="각도"><Num value={fill.angle} step={15} unit="°" onChange={(v) => onChange({ ...fill, angle: v })} /></Row>}
        </>
      )}
    </div>
  );
}

/* ---------- shapes ---------- */

function ShapeSection({ o }: { o: ShapeObj }) {
  const up = (p: Partial<ShapeObj>) => act.update([o.id], p as Partial<LabelObject>);
  return (
    <Section title="도형">
      {o.type !== 'line' && <FillEditor label="채우기" fill={o.fill} onChange={(fill) => up({ fill })} />}
      <Row label="선 색"><Color value={o.stroke} onChange={(c) => up({ stroke: c })} /></Row>
      <div className="grid2">
        <Num label="선 두께" value={o.strokeWidth} step={0.1} min={0} unit="mm" onChange={(v) => up({ strokeWidth: v })} />
        {o.type === 'rect' && <Num label="모서리" value={o.cornerRadius} step={0.5} min={0} unit="mm" onChange={(v) => up({ cornerRadius: v })} />}
      </div>
      <Check label="점선" checked={o.dash} onChange={(v) => up({ dash: v })} />
    </Section>
  );
}

/* ---------- codes ---------- */

function CodeWarning({ o }: { o: BarcodeObj | QrObj }) {
  const project = useStore((s) => s.project);
  const currentRow = useStore((s) => s.currentRow);
  const content = resolveObject(o, previewCtx(project.data.rows[currentRow], currentRow, project.seqStart)).content;
  const res = o.type === 'barcode' ? barcodeSvg(o, content) : code2dSvg(o, content);
  if ('error' in res) return <div className="warn">⚠ {res.error}</div>;
  const mod = moduleSizeMm(o, res);
  const dotMm = 25.4 / project.paper.dpi;
  const minMod = o.type === 'qr' ? 0.33 : 0.19;
  if (mod < Math.max(minMod, dotMm * 2)) return <div className="warn">⚠ 모듈 {mod.toFixed(3)} mm — 인식이 어려울 수 있습니다. 크기를 키우세요 (권장 ≥ {Math.max(minMod, dotMm * 2).toFixed(2)} mm).</div>;
  return <div className="muted small">모듈 크기 {mod.toFixed(3)} mm</div>;
}

function BarcodeSection({ o }: { o: BarcodeObj }) {
  const up = (p: Partial<BarcodeObj>) => act.update([o.id], p as Partial<LabelObject>);
  const all = SYMBOLOGIES.flatMap((g) => g.items);
  const cur = all.find((s) => s.id === o.symbology);
  return (
    <Section title="바코드">
      <Row label="종류">
        <select value={o.symbology} onChange={(e) => up({ symbology: e.target.value })}>
          {SYMBOLOGIES.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>)}
        </select>
      </Row>
      {cur && <Row><button className="link" onClick={() => up({ content: cur.sample })}>예시 값 넣기: {cur.sample}</button></Row>}
      <Row>
        <Check label="문자 표시" checked={o.showText} onChange={(v) => up({ showText: v })} />
        <Check label="비율 유지" checked={o.keepAspect} onChange={(v) => up({ keepAspect: v })} />
      </Row>
      {o.showText && <Row label="문자 크기"><Num value={o.textSize} step={0.5} min={2} unit="pt" onChange={(v) => up({ textSize: v })} /></Row>}
      <Row label="막대 색"><Color value={o.color} onChange={(c) => up({ color: c })} /></Row>
      <Row label="배경"><Color value={o.background} allowNone onChange={(c) => up({ background: c })} /></Row>
      <CodeWarning o={o} />
    </Section>
  );
}

const QR_PRESETS = [
  { l: 'URL', v: 'https://example.com/checkin?id={{ID}}' },
  { l: '참가자 ID', v: '{{ID}}' },
  { l: 'vCard', v: 'BEGIN:VCARD\nVERSION:3.0\nN:{{이름}}\nFN:{{이름}}\nORG:{{소속}}\nTITLE:{{직함}}\nEMAIL:{{이메일}}\nEND:VCARD' },
  { l: 'Wi-Fi', v: 'WIFI:T:WPA;S:네트워크이름;P:비밀번호;;' },
  { l: '이메일', v: 'mailto:{{이메일}}' },
];

function QrSection({ o }: { o: QrObj }) {
  const up = (p: Partial<QrObj>) => act.update([o.id], p as Partial<LabelObject>);
  const isQr = o.symbology === 'qrcode' || o.symbology === 'gs1qrcode';
  return (
    <Section title="QR / 2D 코드">
      <Row label="종류"><Select value={o.symbology} onChange={(v) => up({ symbology: v })} options={CODES_2D.map((c) => ({ value: c.id, label: c.label }))} /></Row>
      <div className="btn-row">{QR_PRESETS.map((p) => <button key={p.l} onClick={() => up({ content: p.v })} title={p.v}>{p.l}</button>)}</div>
      {isQr && (
        <Row label="오류 정정">
          <Seg value={o.logo ? 'H' : o.errorLevel} onChange={(v) => up({ errorLevel: v })} options={(['L', 'M', 'Q', 'H'] as const).map((x) => ({ value: x, label: x, title: { L: '7%', M: '15%', Q: '25%', H: '30%' }[x] }))} />
        </Row>
      )}
      <Row label="여백"><Num value={o.quietZone} step={1} min={0} max={10} unit="모듈" onChange={(v) => up({ quietZone: v })} /></Row>
      <Row label="색"><Color value={o.color} onChange={(c) => up({ color: c })} /></Row>
      <Row label="배경"><Color value={o.background} allowNone onChange={(c) => up({ background: c })} /></Row>
      {isQr && (
        <Row label="로고">
          <button onClick={async () => { const f = await pickFile('image/*'); if (f) up({ logo: await readAsDataURL(f) }); }}>{o.logo ? '변경' : '추가'}</button>
          {o.logo && <button onClick={() => up({ logo: undefined })}>제거</button>}
          {o.logo && <Num value={Math.round(o.logoScale * 100)} step={1} min={5} max={35} unit="%" onChange={(v) => up({ logoScale: v / 100 })} />}
        </Row>
      )}
      <CodeWarning o={o} />
    </Section>
  );
}

/* ---------- effects ---------- */

function EffectsSection({ o }: { o: TextObj | ShapeObj }) {
  const fx = o.effects;
  const set = (e: Effects) => act.update([o.id], { effects: e } as Partial<LabelObject>);
  return (
    <Section title="효과" defaultOpen={!!(fx.shadow || fx.outline)}>
      <Check label="그림자" checked={!!fx.shadow} onChange={(v) => set({ ...fx, shadow: v ? { dx: 0.4, dy: 0.4, blur: 0.4, color: '#000000', opacity: 0.35 } : undefined })} />
      {fx.shadow && (
        <div className="grid2">
          <Num label="X" value={fx.shadow.dx} step={0.1} unit="mm" onChange={(v) => set({ ...fx, shadow: { ...fx.shadow!, dx: v } })} />
          <Num label="Y" value={fx.shadow.dy} step={0.1} unit="mm" onChange={(v) => set({ ...fx, shadow: { ...fx.shadow!, dy: v } })} />
          <Num label="흐림" value={fx.shadow.blur} step={0.1} min={0} unit="mm" onChange={(v) => set({ ...fx, shadow: { ...fx.shadow!, blur: v } })} />
          <Num label="농도" value={Math.round(fx.shadow.opacity * 100)} step={5} min={0} max={100} unit="%" onChange={(v) => set({ ...fx, shadow: { ...fx.shadow!, opacity: v / 100 } })} />
          <Color value={fx.shadow.color} onChange={(c) => set({ ...fx, shadow: { ...fx.shadow!, color: c } })} />
        </div>
      )}
      {o.type === 'text' && (
        <>
          <Check label="외곽선" checked={!!fx.outline} onChange={(v) => set({ ...fx, outline: v ? { width: 0.3, color: '#ffffff', double: false, width2: 0.3, color2: '#000000' } : undefined })} />
          {fx.outline && (
            <>
              <div className="grid2">
                <Num label="두께" value={fx.outline.width} step={0.05} min={0} unit="mm" onChange={(v) => set({ ...fx, outline: { ...fx.outline!, width: v } })} />
                <Color value={fx.outline.color} onChange={(c) => set({ ...fx, outline: { ...fx.outline!, color: c } })} />
              </div>
              <Check label="이중 외곽선" checked={fx.outline.double} onChange={(v) => set({ ...fx, outline: { ...fx.outline!, double: v } })} />
              {fx.outline.double && (
                <div className="grid2">
                  <Num label="두께2" value={fx.outline.width2} step={0.05} min={0} unit="mm" onChange={(v) => set({ ...fx, outline: { ...fx.outline!, width2: v } })} />
                  <Color value={fx.outline.color2} onChange={(c) => set({ ...fx, outline: { ...fx.outline!, color2: c } })} />
                </div>
              )}
            </>
          )}
        </>
      )}
    </Section>
  );
}

/* ---------- conditional rules ---------- */

function RulesSection({ o }: { o: LabelObject }) {
  const columns = useStore((s) => s.project.data.columns);
  const rules = o.rules;
  const set = (r: StyleRule[]) => act.update([o.id], { rules: r });
  const patch = (i: number, p: Partial<StyleRule>) => set(rules.map((r, j) => (j === i ? { ...r, ...p, set: { ...r.set, ...(p.set ?? {}) } } : r)));
  const hasContent = 'content' in o;
  return (
    <Section title={`조건부 스타일${rules.length ? ` (${rules.length})` : ''}`} defaultOpen={rules.length > 0}
      actions={<button className="icon small" title="규칙 추가" onClick={() => set([...rules, { column: columns[0] ?? '', op: 'eq', value: '', set: {} }])}>＋</button>}>
      {!rules.length && <p className="muted small">예: 참가구분 = 연사 → 빨간색 / 영문 이름 → 글자 크기 20pt</p>}
      {rules.map((r, i) => {
        const needs = RULE_OPS.find((x) => x.op === r.op)?.needsValue;
        return (
          <div className="rule" key={i}>
            <div className="rule-if">
              <span className="muted">만약</span>
              <select value={r.column} onChange={(e) => patch(i, { column: e.target.value })}>
                {hasContent && <option value="">(이 개체 내용)</option>}
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                {r.column && !columns.includes(r.column) && <option value={r.column}>{r.column}</option>}
              </select>
              <Select value={r.op} onChange={(v) => patch(i, { op: v })} options={RULE_OPS.map((x) => ({ value: x.op, label: x.label }))} />
              {needs && <input type="text" value={r.value} onChange={(e) => patch(i, { value: e.target.value })} placeholder="값" />}
              <button className="icon small" title="삭제" onClick={() => set(rules.filter((_, j) => j !== i))}>✕</button>
            </div>
            <div className="rule-then">
              <span className="muted">→</span>
              <Check label="숨김" checked={!!r.set.hidden} onChange={(v) => patch(i, { set: { hidden: v || undefined } })} />
              <Check label="색" checked={!!r.set.color} onChange={(v) => patch(i, { set: { color: v ? '#dc2626' : undefined } })} />
              {r.set.color && <Color value={r.set.color} onChange={(c) => patch(i, { set: { color: c } })} />}
              {o.type === 'text' && (
                <>
                  <Check label="크기" checked={!!r.set.fontSize} onChange={(v) => patch(i, { set: { fontSize: v ? o.fontSize : undefined } })} />
                  {r.set.fontSize !== undefined && <Num value={r.set.fontSize} step={0.5} min={1} unit="pt" onChange={(v) => patch(i, { set: { fontSize: v } })} />}
                </>
              )}
              {hasContent && (
                <input type="text" value={r.set.text ?? ''} placeholder="내용 바꾸기 (선택)" onChange={(e) => patch(i, { set: { text: e.target.value || undefined } })} />
              )}
            </div>
          </div>
        );
      })}
    </Section>
  );
}
