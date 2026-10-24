import bwipjs from 'bwip-js/browser';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import ABOUT from '../about.json';
import { OWN_LICENSE, THIRD_PARTY_LICENSES } from 'virtual:licenses';
import { BUILD_DATE, BUILD_DETAIL, VERSION } from '../build';
import { printPages } from '../io/export';
import { fontFromFile, localFontsSupported, queryLocalFonts, registerFonts } from '../io/fonts';
import { loadRecent, openProjectFile, pickFile, type RecentEntry } from '../io/project';
import { encodeShare, shareUrl, type ShareKind } from '../io/share';
import { newRow } from '../model/defaults';
import { customPaper, labelSize, loadUserPresets, PAPER_KIND_LABEL, paperKind, type PaperKind } from '../model/presets';
import { TEMPLATES, type Template } from '../model/templates';
import type { Paper, Project } from '../model/types';
import { buildItems, DEFAULT_DUPLEX, labelSizeProject, paginate } from '../render/jobs';
import { pickDesign, previewCtx } from '../render/resolve';
import { labelDocument } from '../render/svg';
import { useStore } from '../store';
import { Check, Modal, Num, Row, Seg, Select } from './controls';

/* ---------- serial numbers ---------- */

export function SerialDialog() {
  const project = useStore((s) => s.project);
  const { close, commit, notify } = useStore.getState();
  const hasRows = project.data.rows.length > 0;
  const [col, setCol] = useState('번호');
  const [start, setStart] = useState(1);
  const [step, setStep] = useState(1);
  const [count, setCount] = useState(hasRows ? project.data.rows.length : project.paper.cols * project.paper.rows);
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [pad, setPad] = useState(4);
  const [mode, setMode] = useState<'fill' | 'append' | 'replace'>(hasRows ? 'fill' : 'replace');
  const n = mode === 'fill' ? project.data.rows.length : count;
  const value = (i: number) => {
    const v = start + i * step;
    const s = pad > 0 ? (v < 0 ? '-' + String(-v).padStart(pad, '0') : String(v).padStart(pad, '0')) : String(v);
    return prefix + s + suffix;
  };
  const sample = n <= 6 ? Array.from({ length: n }, (_, i) => value(i)) : [value(0), value(1), value(2), '…', value(n - 1)];
  const apply = () => {
    if (!col.trim()) return;
    commit((p) => {
      const columns = p.data.columns.includes(col) ? p.data.columns : [...p.data.columns, col];
      let rows = p.data.rows;
      if (mode === 'fill') rows = rows.map((r, i) => ({ ...r, values: { ...r.values, [col]: value(i) } }));
      else {
        const add = Array.from({ length: count }, (_, i) => newRow({ [col]: value(i) }));
        rows = mode === 'append' ? [...rows, ...add] : add;
      }
      return { ...p, data: { columns: mode === 'replace' ? [col] : columns, rows } };
    });
    notify(`일련번호 ${n}개 생성`);
    close();
  };
  return (
    <Modal title="일련번호 생성" onClose={close} footer={<><span className="spacer" /><button onClick={close}>취소</button><button className="primary" onClick={apply} disabled={!n}>적용</button></>}>
      <Row label="열 이름"><input value={col} onChange={(e) => setCol(e.target.value)} list="serial-cols" /><datalist id="serial-cols">{project.data.columns.map((c) => <option key={c} value={c} />)}</datalist></Row>
      <div className="grid2">
        <Num label="시작" value={start} step={1} onChange={setStart} />
        <Num label="증감" value={step} step={1} onChange={setStep} title="음수면 감소" />
        <Num label="자릿수" value={pad} step={1} min={0} max={20} onChange={setPad} title="0으로 채울 자릿수 (0 = 채우지 않음)" />
        {mode !== 'fill' && <Num label="개수" value={count} step={1} min={1} max={100000} onChange={(v) => setCount(Math.round(v))} />}
      </div>
      <div className="grid2">
        <Row label="접두"><input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="예: LOT-" /></Row>
        <Row label="접미"><input value={suffix} onChange={(e) => setSuffix(e.target.value)} /></Row>
      </div>
      <Row label="적용">
        <Seg value={mode} onChange={setMode} options={[
          ...(hasRows ? [{ value: 'fill' as const, label: `기존 ${project.data.rows.length}행에 채우기` }] : []),
          { value: 'append', label: '새 행 추가' }, { value: 'replace', label: '데이터 바꾸기' },
        ]} />
      </Row>
      <div className="preview-value">{sample.join(', ')}</div>
      <p className="muted small">데이터 없이 출력 순서대로 번호만 필요하면 내용에 <code>{'{{#seq:0000}}'}</code>을 넣어도 됩니다.</p>
    </Modal>
  );
}

/* ---------- share URL ---------- */

export function ShareDialog() {
  const project = useStore((s) => s.project);
  const { close, notify } = useStore.getState();
  const [o, setO] = useState({ includeData: false, includeImages: true, includeFonts: false });
  const [kind, setKind] = useState<ShareKind>('p');
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    encodeShare(project, o).then((code) => live && setUrl(shareUrl(code, kind))).catch((e) => setUrl('오류: ' + e.message));
    return () => { live = false; };
  }, [project, o, kind]);
  const kb = (new Blob([url]).size / 1024).toFixed(1);
  const qr = useMemo(() => {
    if (!url || url.length > 2200) return '';
    try { return bwipjs.toSVG({ bcid: 'qrcode', text: url, eclevel: 'L', scale: 1 } as never); } catch { return ''; }
  }, [url]);
  return (
    <Modal title="링크로 공유" onClose={close} wide footer={<><span className="spacer" /><button onClick={close}>닫기</button><button className="primary" onClick={async () => { await navigator.clipboard.writeText(url); notify('링크를 복사했습니다.'); }}>링크 복사</button></>}>
      <p className="muted">디자인 설정 전체를 압축해 링크의 # 뒤에 넣습니다. 서버에 아무것도 저장되지 않으며, 링크를 연 사람의 브라우저에서 그대로 복원됩니다.</p>
      <Seg value={kind} onChange={setKind} options={[
        { value: 'p', label: '편집용 링크', title: '편집기에서 디자인을 엽니다' },
        { value: 'q', label: '빠른 출력 링크', title: '편집기 없이 값만 입력해 바로 인쇄하는 화면을 엽니다' },
      ]} />
      <Check label="데이터(명단) 포함 — 개인정보가 링크에 들어갑니다" checked={o.includeData} onChange={(v) => setO({ ...o, includeData: v })} />
      <Check label="이미지 포함" checked={o.includeImages} onChange={(v) => setO({ ...o, includeImages: v })} />
      <Check label="내장 글꼴 포함 (링크가 매우 길어짐)" checked={o.includeFonts} onChange={(v) => setO({ ...o, includeFonts: v })} />
      <textarea className="share-url" readOnly value={url} rows={4} onFocus={(e) => e.target.select()} />
      <p className={Number(kb) > 32 ? 'warn' : 'muted small'}>
        길이 {url.length.toLocaleString()}자 ({kb} KB)
        {Number(kb) > 32 && ' — 메신저나 일부 브라우저에서 잘릴 수 있습니다. 이미지를 빼거나 JSON 파일로 저장해 공유하세요.'}
      </p>
      {qr ? <div className="share-qr" dangerouslySetInnerHTML={{ __html: qr }} /> : url && <p className="muted small">링크가 길어 QR 코드로 만들 수 없습니다.</p>}
    </Modal>
  );
}

/* ---------- start / templates ---------- */

export function Thumb({ p }: { p: Project }) {
  const svg = useMemo(() => {
    const row = p.data.rows[0];
    return labelDocument(p, pickDesign(p, row).objects, previewCtx(row, 0, p.seqStart), { white: true });
  }, [p]);
  return <div className="thumb" dangerouslySetInnerHTML={{ __html: svg }} />;
}

const sizeArea = (k: string) => { const m = k.replace('Ø', '').split('×').map(Number); return m[0] * (m[1] ?? m[0]); };

function TemplateCard({ t, papers, onPick }: { t: Template; papers: Paper[]; onPick: (p: Project) => void }) {
  const [name, setName] = useState(papers[0].name);
  const paper = papers.find((p) => p.name === name) ?? papers[0];
  const preview = useMemo(() => t.make(paper), [t, paper]);
  return (
    <div className="card" role="button" tabIndex={0} onClick={() => onPick(t.make(paper))}
      onKeyDown={(e) => { if (e.key === 'Enter') onPick(t.make(paper)); }}>
      <Thumb p={preview} />
      <strong>{t.name}</strong>
      <span className="muted small">{t.desc}</span>
      <span onClick={(e) => e.stopPropagation()} className="card-paper">
        {papers.length > 1
          ? <Select value={paper.name} onChange={setName} options={papers.map((p) => ({ value: p.name, label: p.name }))} title="용지·크기" />
          : <span className="muted small">{paper.name}</span>}
      </span>
    </div>
  );
}

export function StartDialog({ onLoad }: { onLoad: (p: Project, name?: string) => void }) {
  const { close, notify } = useStore.getState();
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [kind, setKind] = useState<PaperKind | 'all'>('all');
  const [size, setSize] = useState('all');
  const [custom, setCustom] = useState({ w: 50, h: 30, page: 'roll' as 'roll' | 'A4' | 'Letter', gap: 2 });
  const current = useStore((s) => s.project.paper);
  const userPapers = useMemo(loadUserPresets, []);
  useEffect(() => { loadRecent().then(setRecent); }, []);
  const byKind = (p: Paper) => kind === 'all' || paperKind(p) === kind;
  const sizes = useMemo(() => {
    const set = new Set(TEMPLATES.flatMap((t) => t.papers).filter(byKind).map(labelSize));
    return [...set].sort((a, b) => sizeArea(a) - sizeArea(b));
  }, [kind]);
  // papers outside the template lists: every template is built for them (scaled to fit)
  const own: Record<string, Paper> = {
    cur: current,
    ...Object.fromEntries(userPapers.map((p, i) => [`u${i}`, p])),
    custom: customPaper(custom.w, custom.h, custom.page, custom.gap),
  };
  const sizeOk = size === 'all' || sizes.includes(size) || own[size] ? size : 'all';
  const override = own[sizeOk];
  const shown = override
    ? TEMPLATES.map((t) => ({ t, papers: [override] }))
    : TEMPLATES
      .map((t) => ({ t, papers: t.papers.filter((p) => byKind(p) && (sizeOk === 'all' || labelSize(p) === sizeOk)) }))
      .filter((x) => x.papers.length > 0);
  const overrideKey = override ? `${sizeOk}|${override.name}|${override.labelWidth}|${override.labelHeight}` : '';
  const pick = (p: Project) => { onLoad(p); close(); };
  return (
    <Modal title="LabelLoom — 새로 만들기" onClose={close} wide="xl">
      <div className="start-actions">
        <button onClick={async () => { try { const r = await openProjectFile(); if (r) { onLoad(r.project, r.name); close(); } } catch (e) { notify((e as Error).message); } }}>📂 프로젝트 열기 (.json)</button>
        <button onClick={close}>현재 작업 계속</button>
      </div>
      <h3>템플릿</h3>
      <div className="tpl-filter">
        <span className="muted small">용지</span>
        <Seg value={kind} onChange={setKind} options={[
          { value: 'all', label: '전체' },
          ...(Object.keys(PAPER_KIND_LABEL) as PaperKind[]).map((k) => ({ value: k, label: PAPER_KIND_LABEL[k] })),
        ]} />
        <span className="muted small">라벨 크기</span>
        <Select value={sizeOk} onChange={setSize} options={[
          { value: 'all', label: '전체 크기' },
          ...sizes.map((k) => ({ value: k, label: `${k} mm` })),
          { value: 'cur', label: `현재 용지 · ${current.name} (${labelSize(current)})` },
          ...userPapers.map((p, i) => ({ value: `u${i}`, label: `내 용지 · ${p.name} (${labelSize(p)})` })),
          { value: 'custom', label: '크기 직접 입력…' },
        ]} />
        <span className="muted small">{shown.length}개 템플릿</span>
      </div>
      {sizeOk === 'custom' && (
        <div className="tpl-filter">
          <Num label="폭" value={custom.w} step={0.5} min={5} max={1000} unit="mm" width={64} onChange={(w) => setCustom({ ...custom, w })} />
          <Num label="높이" value={custom.h} step={0.5} min={5} max={1000} unit="mm" width={64} onChange={(h) => setCustom({ ...custom, h })} />
          <Seg value={custom.page} onChange={(page) => setCustom({ ...custom, page })} options={[
            { value: 'roll', label: '낱장·롤', title: '라벨 한 장 크기의 용지' },
            { value: 'A4', label: 'A4에 채우기' },
            { value: 'Letter', label: 'Letter에 채우기' },
          ]} />
          {custom.page !== 'roll' && <Num label="간격" value={custom.gap} step={0.5} min={0} unit="mm" width={56} onChange={(gap) => setCustom({ ...custom, gap })} />}
          <span className="muted small">{override.name}{override.cols * override.rows > 1 ? ` · ${override.cols * override.rows}칸` : ''}</span>
        </div>
      )}
      {override && <p className="muted small">모든 템플릿을 이 크기에 맞춰 늘이거나 줄여 만듭니다{override.preprint ? ' (견출지는 입력 영역 안에 배치)' : ''}. 비율이 많이 다르면 배치를 다듬어 주세요.</p>}
      <div className="gallery">
        {shown.map(({ t, papers }) => (
          <TemplateCard key={`${t.id}|${kind}|${sizeOk}|${overrideKey}`} t={t} papers={papers} onPick={pick} />
        ))}
      </div>
      {recent.length > 0 && (
        <>
          <h3>최근 저장한 작업</h3>
          <div className="gallery">
            {recent.map((r) => (
              <button key={r.id} className="card" onClick={() => { onLoad(r.project, r.name); close(); }}>
                <Thumb p={r.project} />
                <strong>{r.name}</strong>
                <span className="muted small">{new Date(r.savedAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------- on-site reprint / registration ---------- */

export function ReprintDialog() {
  const project = useStore((s) => s.project);
  const { close, commit, notify, setCurrentRow } = useStore.getState();
  const [q, setQ] = useState('');
  const [labelPage, setLabelPage] = useState(project.paper.cols * project.paper.rows > 1);
  const [cell, setCell] = useState(1);
  const [form, setForm] = useState<Record<string, string>>({});
  const cols = project.data.columns;
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return project.data.rows.map((r, i) => ({ r, i })).filter(({ r }) => Object.values(r.values).some((v) => v.toLowerCase().includes(t))).slice(0, 30);
  }, [q, project]);

  const printOne = (rowId: string, p: Project = project) => {
    const index = p.data.rows.findIndex((r) => r.id === rowId);
    const proj: Project = labelPage ? labelSizeProject(p) : p;
    const items = buildItems(proj, { scope: 'current', currentRow: index, rangeFrom: 1, rangeTo: 1, copies: 1, blankCount: 1, startCell: 1, ...DEFAULT_DUPLEX });
    printPages(proj, paginate(proj, items, { startCell: labelPage ? 1 : cell, duplex: false }), { calibrate: !labelPage });
    const now = new Date().toISOString();
    commit((x) => ({ ...x, data: { ...x.data, rows: x.data.rows.map((r) => (r.id === rowId ? { ...r, printed: now } : r)) } }));
    setCurrentRow(index);
  };

  const register = () => {
    if (!Object.values(form).some((v) => v.trim())) return;
    const row = newRow(form);
    const next: Project = { ...project, data: { ...project.data, rows: [...project.data.rows, row] } };
    commit(() => next);
    notify('현장 등록 완료');
    printOne(row.id, next);
    setForm({});
  };

  return (
    <Modal title="현장 재발행 · 현장 등록" onClose={close} wide>
      <Row label="출력">
        <Seg value={labelPage ? 'label' : 'sheet'} onChange={(v) => setLabelPage(v === 'label')} options={[{ value: 'label', label: '라벨 크기 1장 (라벨 프린터)' }, { value: 'sheet', label: '현재 용지의 칸 지정' }]} />
        {!labelPage && <Num value={cell} step={1} min={1} max={project.paper.cols * project.paper.rows} onChange={setCell} unit="번째 칸" width={130} />}
      </Row>
      <h3>재발행 — 이름·소속·ID로 찾기</h3>
      <input type="search" autoFocus placeholder="검색어 입력…" value={q} onChange={(e) => setQ(e.target.value)} className="wide-input" />
      <ul className="hits">
        {hits.map(({ r, i }) => (
          <li key={r.id}>
            <span className="idx">{i + 1}</span>
            <span className="ellipsis">{cols.slice(0, 4).map((c) => r.values[c]).filter(Boolean).join(' · ')}</span>
            <span className={`status ${r.printed ? 'done' : ''}`}>{r.printed ? `출력 ${new Date(r.printed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '미출력'}</span>
            <button className="primary" onClick={() => printOne(r.id)}>인쇄</button>
          </li>
        ))}
        {q && !hits.length && <li className="muted">찾는 사람이 없습니다. 아래에서 현장 등록하세요.</li>}
      </ul>
      <h3>현장 등록 — 새 참가자 추가 후 바로 인쇄</h3>
      {cols.length ? (
        <div className="grid2">
          {cols.map((c) => <Row key={c} label={c}><input value={form[c] ?? ''} onChange={(e) => setForm({ ...form, [c]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && register()} /></Row>)}
        </div>
      ) : <p className="muted">데이터 열이 없습니다. 먼저 명단을 가져오거나 열을 추가하세요.</p>}
      <div className="btn-row"><span className="spacer" /><button className="primary" disabled={!cols.length} onClick={register}>등록하고 인쇄</button></div>
    </Modal>
  );
}

/* ---------- calibration ---------- */

export function CalibrationDialog() {
  const cal = useStore((s) => s.project.calibration);
  const { close, commit } = useStore.getState();
  const up = (p: Partial<typeof cal>) => commit((x) => ({ ...x, calibration: { ...x.calibration, ...p } }));
  return (
    <Modal title="프린터 정렬 보정" onClose={close} footer={<><button onClick={() => up({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 })}>초기화</button><span className="spacer" /><button className="primary" onClick={close}>완료</button></>}>
      <ol className="steps">
        <li>인쇄 · 내보내기 창의 <b>정렬 테스트 페이지</b>를 일반 용지에 인쇄합니다 (배율 100%, "실제 크기").</li>
        <li>라벨지 위에 겹쳐 보거나 자로 재어 테두리가 어긋난 만큼 아래에 입력합니다.</li>
        <li>오른쪽/아래로 밀려 나오면 음수, 왼쪽/위로 치우치면 양수를 넣습니다. 50 mm 눈금이 실제와 다르면 배율을 고칩니다.</li>
      </ol>
      <div className="grid2">
        <Num label="X 이동" value={cal.offsetX} step={0.1} unit="mm" onChange={(v) => up({ offsetX: v })} />
        <Num label="Y 이동" value={cal.offsetY} step={0.1} unit="mm" onChange={(v) => up({ offsetY: v })} />
        <Num label="X 배율" value={cal.scaleX * 100} step={0.1} unit="%" onChange={(v) => up({ scaleX: v / 100 })} />
        <Num label="Y 배율" value={cal.scaleY * 100} step={0.1} unit="%" onChange={(v) => up({ scaleY: v / 100 })} />
      </div>
      <p className="muted small">보정값은 프로젝트에 저장되며 인쇄·PDF 출력에 적용됩니다 (내보내기 창에서 끌 수 있음).</p>
    </Modal>
  );
}

/* ---------- fonts ---------- */

export function FontsDialog() {
  const project = useStore((s) => s.project);
  const { close, commit, notify } = useStore.getState();
  const [local, setLocal] = useState<string[]>((window as unknown as { __localFonts?: string[] }).__localFonts ?? []);
  const [pick, setPick] = useState('');
  const fonts = project.fonts;
  const add = async (f: Awaited<ReturnType<typeof fontFromFile>>) => {
    const next = { ...project, fonts: [...project.fonts.filter((x) => x.family !== f.family), f] };
    commit(() => next);
    await registerFonts(next);
    notify(`"${f.family}" 글꼴을 내장했습니다.`);
  };
  const upload = async () => {
    const file = await pickFile('.ttf,.otf,.woff,.woff2');
    if (!file) return;
    const family = prompt('글꼴 이름 (디자인에서 쓸 이름)', file.name.replace(/\.(ttf|otf|woff2?)$/i, ''));
    if (!family) return;
    await add(await fontFromFile(file, family));
  };
  const loadLocal = async () => {
    const list = await queryLocalFonts();
    const fams = [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'ko'));
    (window as unknown as { __localFonts?: string[] }).__localFonts = fams;
    (window as unknown as { __localFontData?: typeof list }).__localFontData = list;
    window.dispatchEvent(new Event('labelloom:fonts'));
    setLocal(fams);
    if (!fams.length) notify('글꼴 목록을 가져오지 못했습니다 (권한 거부 또는 미지원).');
  };
  const embedLocal = async () => {
    const data = (window as unknown as { __localFontData?: Awaited<ReturnType<typeof queryLocalFonts>> }).__localFontData ?? [];
    const f = data.find((x) => x.family === pick && /regular|normal|^$/i.test(x.style)) ?? data.find((x) => x.family === pick);
    if (!f) return;
    await add(await fontFromFile(await f.blob(), pick));
  };
  const size = (b64: string) => `${((b64.length * 3) / 4 / 1024 / 1024).toFixed(2)} MB`;
  return (
    <Modal title="글꼴 관리" onClose={close} wide footer={<><span className="spacer" /><button className="primary" onClick={close}>닫기</button></>}>
      <p className="muted">글꼴 파일을 프로젝트에 내장하면 다른 컴퓨터에서 열어도 같은 글꼴로 보이고, <b>TTF</b> 글꼴은 PDF에 벡터 텍스트로 들어갑니다.</p>
      <h3>내장된 글꼴 ({fonts.length})</h3>
      <ul className="font-list">
        {fonts.map((f) => (
          <li key={f.family}>
            <span style={{ fontFamily: `"${f.family}"` }} className="font-sample">{f.family} 가나다 ABC 123</span>
            <span className="muted small">{f.format} · {size(f.data)}</span>
            {f.format === 'truetype' ? <span className="ok small">PDF 벡터</span> : <span className="muted small">PDF 이미지</span>}
            <button className="icon tiny" onClick={() => commit((p) => ({ ...p, fonts: p.fonts.filter((x) => x.family !== f.family) }))}>✕</button>
          </li>
        ))}
        {!fonts.length && <li className="muted">없음</li>}
      </ul>
      <div className="btn-row"><button onClick={upload}>글꼴 파일 추가 (TTF·OTF·WOFF)…</button></div>
      <h3>이 컴퓨터의 글꼴</h3>
      {localFontsSupported() ? (
        <>
          <div className="btn-row">
            <button onClick={loadLocal}>글꼴 목록 불러오기</button>
            {local.length > 0 && <span className="muted small">{local.length}개 — 글꼴 입력란 자동완성에 추가됨</span>}
          </div>
          {local.length > 0 && (
            <div className="btn-row">
              <select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">글꼴 선택…</option>{local.map((f) => <option key={f}>{f}</option>)}</select>
              <button disabled={!pick} onClick={embedLocal}>프로젝트에 내장</button>
            </div>
          )}
        </>
      ) : <p className="muted small">이 브라우저는 로컬 글꼴 목록을 지원하지 않습니다 (Chrome/Edge에서 지원). 글꼴 이름을 직접 입력해도 설치된 글꼴이면 사용됩니다.</p>}
    </Modal>
  );
}

/* ---------- shortcuts ---------- */

const KEYS: [string, string][] = [
  ['V / T / R / O / L / B / Q / I', '선택 / 텍스트 / 사각형 / 원 / 선 / 바코드 / QR / 이미지 도구'],
  ['Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y', '실행 취소 / 다시 실행'],
  ['Ctrl+C / X / V / D', '복사 / 잘라내기 / 붙여넣기 / 복제'],
  ['Delete, Backspace', '삭제'],
  ['방향키 (Shift)', '0.5 mm (5 mm) 이동'],
  ['Ctrl+A', '모두 선택'],
  ['Ctrl+G / Ctrl+Shift+G', '그룹 / 그룹 해제'],
  ['Ctrl+] / Ctrl+[ (Shift)', '앞으로 / 뒤로 (맨 앞 / 맨 뒤)'],
  ['Ctrl+S / Ctrl+Shift+S', '저장 / 다른 이름으로 저장'],
  ['Ctrl+O', '열기'],
  ['Ctrl+P', '인쇄 · 내보내기'],
  ['Ctrl+휠, Ctrl+= / Ctrl+-', '확대 / 축소'],
  ['Ctrl+0', '화면에 맞추기'],
  ['Space+드래그, 휠', '화면 이동'],
  ['Shift+드래그', '수평/수직 이동, 비율 유지 크기 조절, 15° 회전'],
  ['Alt+드래그', '스냅 끄기'],
  ['Ctrl/Alt+클릭', '그룹 안의 개체 하나만 선택'],
  ['PageUp / PageDown', '이전 / 다음 데이터 행 미리보기'],
  ['Esc', '선택 해제 / 선택 도구'],
  ['표 더블클릭, Enter', '표 칸 편집 시작 (바로 입력하면 칸이 채워짐)'],
  ['표: Enter / Tab / 방향키', '아래 칸 / 다음 칸 / 칸 이동 (Shift로 여러 칸)'],
  ['표: Alt+Enter, F2', '칸 안 줄바꿈 / 칸 내용 고치기'],
  ['표: Ctrl+C / V, Delete', '칸 복사 / 엑셀 표 붙여넣기, 내용 지우기'],
  ['표: Esc', '칸 입력 취소 → 표 편집 끝내기'],
];

export function ShortcutsDialog() {
  const { close } = useStore.getState();
  return (
    <Modal title="단축키" onClose={close}>
      <table className="keys"><tbody>{KEYS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
    </Modal>
  );
}

/* ---------- about (content lives in src/about.json) ---------- */

const linked = (text: string, url?: string): ReactNode =>
  url ? <a href={url} target="_blank" rel="noreferrer">{text}</a> : text;

export function AboutDialog() {
  const { close } = useStore.getState();
  const info = [
    ...ABOUT.info.filter((r) => r.value),
    { label: '버전', value: `v${VERSION}`, url: '' },
    { label: '빌드', value: BUILD_DATE, url: '' },
  ];
  const credits = ABOUT.credits.filter((c) => c.name);
  const [text, setText] = useState<'own' | 'third' | null>(null);
  const toggle = (t: 'own' | 'third') => setText(text === t ? null : t);
  return (
    <Modal title="프로그램 정보" onClose={close}>
      <div className="about">
        <div className="about-head">
          <h3>{ABOUT.name}</h3>
          {ABOUT.subtitle && <div className="muted">{ABOUT.subtitle}</div>}
        </div>
        {ABOUT.description && <p className="about-text">{ABOUT.description}</p>}
        <table className="keys"><tbody>
          {info.map((r) => (
            <tr key={r.label}><td className="muted">{r.label}</td><td title={r.label === '빌드' ? BUILD_DETAIL : undefined}>{linked(r.value, r.url)}</td></tr>
          ))}
        </tbody></table>
        {ABOUT.notice && <p className="about-text">{ABOUT.notice}</p>}
        {credits.length > 0 && <>
          <h4>사용한 오픈소스</h4>
          <table className="keys small"><tbody>
            {credits.map((c) => <tr key={c.name}><td>{linked(c.name, c.url)}</td><td className="muted">{c.license}</td></tr>)}
          </tbody></table>
        </>}
        {ABOUT.copyright && <p className="muted small">{ABOUT.copyright}</p>}
        <div className="row-btns">
          <button className={text === 'own' ? 'on' : ''} onClick={() => toggle('own')}>LabelLoom 라이선스 전문</button>
          <button className={text === 'third' ? 'on' : ''} onClick={() => toggle('third')}>오픈소스 라이선스 전문</button>
        </div>
        {text && <pre className="license-text">{text === 'own' ? OWN_LICENSE : THIRD_PARTY_LICENSES}</pre>}
      </div>
    </Modal>
  );
}
