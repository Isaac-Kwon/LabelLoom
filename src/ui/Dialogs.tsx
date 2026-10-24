import bwipjs from 'bwip-js/browser';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import ABOUT from '../about.json';
import { OWN_LICENSE, THIRD_PARTY_LICENSES } from 'virtual:licenses';
import { BUILD_DATE, BUILD_DETAIL, VERSION } from '../build';
import { getLang, loc, locale, m, t, tn, tx, type Msg } from '../i18n';
import { printPages } from '../io/export';
import { fontFromFile, localFontsSupported, queryLocalFonts, registerFonts } from '../io/fonts';
import { loadRecent, openProjectFile, pickFile, type RecentEntry } from '../io/project';
import { downloadShareFile, downloadShareZip, encodeShare, kbOf, LINK_LIMIT, mainCause, measureShare, partLabel, shareUrl, type ShareKind, type SharePart, type SharePartSize } from '../io/share';
import { newProject, newRow } from '../model/defaults';
import { customPaper, labelSize, loadUserPresets, PAPER_KIND_LABEL, paperKind, type PaperKind } from '../model/presets';
import { soldIn, STOCK_VENDOR_LABEL, stockItems, stockMatches, type StockCountry, type StockVendor } from '../model/stock';
import { TEMPLATES, type Template } from '../model/templates';
import type { Paper, Project } from '../model/types';
import { buildItems, DEFAULT_DUPLEX, labelSizeProject, paginate } from '../render/jobs';
import { pickDesign, previewCtx } from '../render/resolve';
import { labelDocument } from '../render/svg';
import { useStore } from '../store';
import { LESSONS, lessonProject, type Lesson } from '../tutorial/lessons';
import { Check, Modal, Num, Row, Seg, Select } from './controls';

/* ---------- serial numbers ---------- */

export function SerialDialog() {
  const project = useStore((s) => s.project);
  const { close, commit, notify } = useStore.getState();
  const hasRows = project.data.rows.length > 0;
  const [col, setCol] = useState(() => t('번호'));
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
    notify(t('일련번호 {n}개 생성', { n }));
    close();
  };
  return (
    <Modal title={t('일련번호 생성')} onClose={close} footer={<><span className="spacer" /><button onClick={close}>{t('취소')}</button><button className="primary" onClick={apply} disabled={!n}>{t('적용')}</button></>}>
      <Row label={t('열 이름')}><input value={col} onChange={(e) => setCol(e.target.value)} list="serial-cols" /><datalist id="serial-cols">{project.data.columns.map((c) => <option key={c} value={c} />)}</datalist></Row>
      <div className="grid2">
        <Num label={t('시작')} value={start} step={1} onChange={setStart} />
        <Num label={t('증감')} value={step} step={1} onChange={setStep} title={t('음수면 감소')} />
        <Num label={t('자릿수')} value={pad} step={1} min={0} max={20} onChange={setPad} title={t('0으로 채울 자릿수 (0 = 채우지 않음)')} />
        {mode !== 'fill' && <Num label={t('개수')} value={count} step={1} min={1} max={100000} onChange={(v) => setCount(Math.round(v))} />}
      </div>
      <div className="grid2">
        <Row label={t('접두')}><input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={t('예: LOT-')} /></Row>
        <Row label={t('접미')}><input value={suffix} onChange={(e) => setSuffix(e.target.value)} /></Row>
      </div>
      <Row label={t('적용')}>
        <Seg value={mode} onChange={setMode} options={[
          ...(hasRows ? [{ value: 'fill' as const, label: t('기존 {n}행에 채우기', { n: project.data.rows.length }) }] : []),
          { value: 'append', label: t('새 행 추가') }, { value: 'replace', label: t('데이터 바꾸기') },
        ]} />
      </Row>
      <div className="preview-value">{sample.join(', ')}</div>
      <p className="muted small">{tn('데이터 없이 출력 순서대로 번호만 필요하면 내용에 {code}을 넣어도 됩니다.', { code: <code>{'{{#seq:0000}}'}</code> })}</p>
    </Modal>
  );
}

/* ---------- share URL ---------- */

const SHARE_OPTION: Partial<Record<SharePart, Msg>> = { images: m('이미지 포함'), data: m('데이터(명단) 포함'), fonts: m('내장 글꼴 포함') };

export function ShareDialog() {
  const project = useStore((s) => s.project);
  const { close, notify } = useStore.getState();
  const [o, setO] = useState({ includeData: false, includeImages: true, includeFonts: false });
  const [kind, setKind] = useState<ShareKind>('p');
  const [url, setUrl] = useState('');
  const [parts, setParts] = useState<SharePartSize[] | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const code = await encodeShare(project, o);
      const u = shareUrl(code, kind);
      if (!live) return;
      setUrl(u);
      setParts(null);
      if (new Blob([u]).size > LINK_LIMIT) {
        const ps = await measureShare(project, o, code);
        if (live) setParts(ps);
      }
    })().catch((e) => live && setUrl(t('오류: {error}', { error: e.message })));
    return () => { live = false; };
  }, [project, o, kind]);
  const size = new Blob([url]).size;
  const long = size > LINK_LIMIT;
  const qr = useMemo(() => {
    if (!url || url.length > 2200) return '';
    try { return bwipjs.toSVG({ bcid: 'qrcode', text: url, eclevel: 'L', scale: 1 } as never); } catch { return ''; }
  }, [url]);
  // what makes the link long, measured; leaving that part out is suggested only when it is an option and would be enough
  const main = parts?.[0];
  const option = main && SHARE_OPTION[main.part];
  const smaller = main ? size - main.bytes : 0;
  // pictures and fonts keep their original files in a ZIP, so suggest it when they make the link long
  const zipFirst = main?.part === 'images' || main?.part === 'fonts';
  return (
    <Modal title={t('링크로 공유')} onClose={close} wide footer={<><span className="spacer" /><button onClick={close}>{t('닫기')}</button>
      <button className={long && !zipFirst ? 'primary' : ''} onClick={() => downloadShareFile(project, o)} title={t('링크와 같은 내용을 .labelloom.json 파일로 받습니다')}>{t('JSON 파일로 받기')}</button>
      <button className={long && zipFirst ? 'primary' : ''} onClick={() => downloadShareZip(project, o).catch((e) => notify(e.message))}
        title={t('링크와 같은 내용을 .labelloom.zip 파일로 받습니다. 그림과 글꼴이 원본 파일로 들어갑니다')}>{t('ZIP 파일로 받기')}</button>
      <button className={long ? '' : 'primary'} onClick={async () => { await navigator.clipboard.writeText(url); notify(t('링크를 복사했습니다.')); }}>{t('링크 복사')}</button></>}>
      <p className="muted">{t('디자인 설정 전체를 압축해 링크의 # 뒤에 넣습니다. 서버에 아무것도 저장되지 않으며, 링크를 연 사람의 브라우저에서 그대로 복원됩니다.')}</p>
      <Seg value={kind} onChange={setKind} options={[
        { value: 'p', label: t('편집용 링크'), title: t('편집기에서 디자인을 엽니다') },
        { value: 'q', label: t('빠른 출력 링크'), title: t('편집기 없이 값만 입력해 바로 인쇄하는 화면을 엽니다') },
      ]} />
      <Check label={t('데이터(명단) 포함 — 개인정보가 링크에 들어갑니다')} checked={o.includeData} onChange={(v) => setO({ ...o, includeData: v })} />
      <Check label={t('이미지 포함')} checked={o.includeImages} onChange={(v) => setO({ ...o, includeImages: v })} />
      <Check label={t('내장 글꼴 포함 (링크가 매우 길어짐)')} checked={o.includeFonts} onChange={(v) => setO({ ...o, includeFonts: v })} />
      <textarea className="share-url" readOnly value={url} rows={4} onFocus={(e) => e.target.select()} />
      <p className="muted small">{t('길이 {n}자 ({kb} KB)', { n: url.length.toLocaleString(locale()), kb: kbOf(size) })}</p>
      {long && <div className="warn">
        <div>{t('링크가 길어 메신저나 일부 브라우저에서 잘릴 수 있습니다. 파일로 받아서 보내세요.')}</div>
        {main && parts && <>
          <div><strong>{t('주요 원인: {cause}', { cause: mainCause(parts, project, size) })}</strong></div>
          <div>{!option ? t('링크에서 뺄 수 있는 부분이 아니므로 파일로 보내야 합니다.')
            : smaller > LINK_LIMIT ? t("'{option}'을(를) 꺼도 {kb} KB라 여전히 깁니다.", { option: t(option), kb: kbOf(smaller) })
              : t("'{option}'을(를) 끄면 {kb} KB로 줄지만, 받는 쪽에는 그만큼 빠진 채로 열립니다.", { option: t(option), kb: kbOf(smaller) })}</div>
          {parts.length > 1 && <div className="small">{t('구성: {list}', { list: parts.filter((x) => x.bytes).map((x) => `${partLabel(x, project)} ${kbOf(x.bytes)} KB`).join(' · ') })}</div>}
        </>}
      </div>}
      {qr ? <div className="share-qr" dangerouslySetInnerHTML={{ __html: qr }} /> : url && <p className="muted small">{t('링크가 길어 QR 코드로 만들 수 없습니다.')}</p>}
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

function TemplateCard({ t: tpl, papers, onPick }: { t: Template; papers: Paper[]; onPick: (p: Project) => void }) {
  const [name, setName] = useState(papers[0].name);
  const paper = papers.find((p) => p.name === name) ?? papers[0];
  const preview = useMemo(() => tpl.make(paper), [tpl, paper]);
  return (
    <div className="card" role="button" tabIndex={0} onClick={() => onPick(tpl.make(paper))}
      onKeyDown={(e) => { if (e.key === 'Enter') onPick(tpl.make(paper)); }}>
      <Thumb p={preview} />
      <strong>{tpl.name()}</strong>
      <span className="muted small">{tpl.desc()}</span>
      <span onClick={(e) => e.stopPropagation()} className="card-paper">
        {papers.length > 1
          ? <Select value={paper.name} onChange={setName} options={papers.map((p) => ({ value: p.name, label: tx(p.name) }))} title={t('용지·크기')} />
          : <span className="muted small">{tx(paper.name)}</span>}
      </span>
    </div>
  );
}

function LessonCard({ lesson, n, onPick }: { lesson: Lesson; n: number; onPick: (p: Project) => void }) {
  const preview = useMemo(() => lesson.make(), [lesson]);
  return (
    <div className="card" role="button" tabIndex={0} onClick={() => onPick(lessonProject(lesson))}
      onKeyDown={(e) => { if (e.key === 'Enter') onPick(lessonProject(lesson)); }}>
      <Thumb p={preview} />
      <strong>{n}. {t(lesson.title)}</strong>
      <span className="muted small">{t(lesson.summary)}</span>
    </div>
  );
}

/** The label layout of a sheet (or a single roll label), without any design. */
function SheetThumb({ p }: { p: Paper }) {
  const cells = [];
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      cells.push(<rect key={`${r}-${c}`} x={p.marginLeft + c * (p.labelWidth + p.gapX)} y={p.marginTop + r * (p.labelHeight + p.gapY)}
        width={p.labelWidth} height={p.labelHeight} rx={p.cornerRadius} fill="#eef2ff" stroke="#6366f1" strokeWidth={Math.max(p.width, p.height) / 300} />);
    }
  }
  return (
    <div className="thumb">
      <svg viewBox={`0 0 ${p.width} ${p.height}`} width={p.width * 2} height={p.height * 2}>
        <rect width={p.width} height={p.height} fill="#fff" />
        {cells}
      </svg>
    </div>
  );
}

const STOCK_VENDORS = Object.keys(STOCK_VENDOR_LABEL) as StockVendor[];
type CountryFilter = StockCountry | 'EU' | 'all';
const COUNTRY_FILTERS: CountryFilter[] = ['all', 'KR', 'US', 'EU', 'IT', 'FR', 'DE', 'GB', 'ES', 'JP'];
/** The stock sold where the UI language is spoken comes first; English is spoken too widely to guess. */
const LANG_COUNTRY: Record<string, CountryFilter> = { ko: 'KR', it: 'IT', fr: 'FR', en: 'all' };

function regionName(code: string) {
  try { return new Intl.DisplayNames([locale()], { type: 'region' }).of(code) ?? code; } catch { return code; }
}
const countryLabel = (c: CountryFilter) => (c === 'all' ? t('모든 국가') : c === 'EU' ? t('유럽 전체') : regionName(c));

function StockPane({ onBlank, onTemplates }: { onBlank: (p: Paper) => void; onTemplates: (p: Paper) => void }) {
  const [vendor, setVendor] = useState<StockVendor | 'all'>('all');
  const [country, setCountry] = useState<CountryFilter>(() => LANG_COUNTRY[getLang()] ?? 'all');
  const [q, setQ] = useState('');
  const all = useMemo(() => stockItems().map((item) => ({ item, paper: item.paper() })), []);
  const shown = all.filter(({ item, paper }) => (vendor === 'all' || item.vendor === vendor) && soldIn(item, country) && stockMatches(item, paper, q));
  return (
    <>
      <div className="warn stock-disclaimer">
        <b>{t('기성품 규격은 참고값입니다.')}</b>{' '}
        {t('각 제조사가 배포한 서식과 Word 라벨 정의에서 옮긴 값으로, 같은 제품도 생산 시기에 따라 조금씩 다를 수 있고 프린터마다 1~2 mm 급지 오차가 있습니다. 많이 인쇄하기 전에 일반 용지에 한 장 시험 출력해 라벨지와 겹쳐 보고, 어긋나면 인쇄 보정을 하세요.')}{' '}
        {t('제품명과 상표는 각 소유자의 것이며 LabelLoom은 제조사와 관계가 없습니다.')}
      </div>
      <div className="tpl-filter">
        <span className="muted small">{t('사용 국가')}</span>
        <Select value={country} onChange={(v) => setCountry(v as CountryFilter)} options={COUNTRY_FILTERS.map((c) => ({ value: c, label: countryLabel(c) }))} />
        <Seg value={vendor} onChange={setVendor} options={[
          { value: 'all', label: t('전체') },
          ...STOCK_VENDORS.map((v) => ({ value: v, label: t(STOCK_VENDOR_LABEL[v]) })),
        ]} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('코드·크기 검색 (예: 3108, V3230, 99.1x38.1)')} className="stock-search" />
        <span className="muted small">{t('{n}종', { n: shown.length })}</span>
      </div>
      <div className="gallery">
        {shown.map(({ item, paper }) => (
          <div key={item.id} className="card" role="button" tabIndex={0} title={t('이 용지로 빈 라벨을 만듭니다')}
            onClick={() => onBlank(paper)} onKeyDown={(e) => { if (e.key === 'Enter') onBlank(paper); }}>
            <SheetThumb p={paper} />
            <strong>{item.vendor === 'roll' ? item.code : `${t(STOCK_VENDOR_LABEL[item.vendor])} ${item.code}`}</strong>
            <span className="muted small">
              {labelSize(paper)} mm{paper.cols * paper.rows > 1 ? ` · ${t('{n}칸', { n: paper.cols * paper.rows })}` : ''}
              {paper.width !== paper.labelWidth || paper.height !== paper.labelHeight ? ` · ${paperKind(paper) === 'roll' ? `${paper.width}×${paper.height}` : t(PAPER_KIND_LABEL[paperKind(paper)])}` : ''}
            </span>
            <span className="muted small" title={item.countries.map((c) => (c === '*' ? t('여러 나라에서 판매') : regionName(c))).join(', ')}>
              {item.countries.includes('*') ? t('전 세계') : item.countries.join(' · ')}
            </span>
            {item.confidence !== 'high' && <span className="stock-check small" title={t('제조사 서식에서만 확인했거나 자료끼리 값이 달라 실측이 필요합니다')}>{t('시험 출력 권장')}</span>}
            <span className="card-paper" onClick={(e) => e.stopPropagation()}>
              <button className="small" onClick={() => onTemplates(paper)}>{t('템플릿 적용…')}</button>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export function StartDialog({ onLoad }: { onLoad: (p: Project, name?: string) => void }) {
  const { close, notify } = useStore.getState();
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [kind, setKind] = useState<PaperKind | 'all'>('all');
  const [size, setSize] = useState('all');
  const [custom, setCustom] = useState({ w: 50, h: 30, page: 'roll' as 'roll' | 'A4' | 'Letter', gap: 2 });
  const [tab, setTab] = useState<'templates' | 'stock' | 'tutorial'>(() => (useStore.getState().dialogArg === 'tutorial' ? 'tutorial' : 'templates'));
  const [stock, setStock] = useState<Paper | null>(null);
  const current = useStore((s) => s.project.paper);
  const userPapers = useMemo(loadUserPresets, []);
  useEffect(() => { loadRecent().then(setRecent); }, []);
  const byKind = (p: Paper) => kind === 'all' || paperKind(p) === kind;
  const sizes = useMemo(() => {
    const set = new Set(TEMPLATES.flatMap((x) => x.papers).filter(byKind).map(labelSize));
    return [...set].sort((a, b) => sizeArea(a) - sizeArea(b));
  }, [kind]);
  // papers outside the template lists: every template is built for them (scaled to fit)
  const own: Record<string, Paper> = {
    cur: current,
    ...(stock ? { stock } : {}),
    ...Object.fromEntries(userPapers.map((p, i) => [`u${i}`, p])),
    custom: customPaper(custom.w, custom.h, custom.page, custom.gap),
  };
  const sizeOk = size === 'all' || sizes.includes(size) || own[size] ? size : 'all';
  const override = own[sizeOk];
  const shown = override
    ? TEMPLATES.map((x) => ({ t: x, papers: [override] }))
    : TEMPLATES
      .map((x) => ({ t: x, papers: x.papers.filter((p) => byKind(p) && (sizeOk === 'all' || labelSize(p) === sizeOk)) }))
      .filter((x) => x.papers.length > 0);
  const overrideKey = override ? `${sizeOk}|${override.name}|${override.labelWidth}|${override.labelHeight}` : '';
  const pick = (p: Project) => { onLoad(p); close(); };
  return (
    <Modal title={`LabelLoom — ${t('새로 만들기')}`} onClose={close} wide="xl">
      <div className="start-actions">
        <button onClick={async () => { try { const r = await openProjectFile(); if (r) { onLoad(r.project, r.name); close(); } } catch (e) { notify((e as Error).message); } }}>📂 {t('프로젝트 열기 (.json · .zip)')}</button>
        <button onClick={close}>{t('현재 작업 계속')}</button>
      </div>
      <div className="tabs start-tabs">
        <button className={tab === 'templates' ? 'on' : ''} onClick={() => setTab('templates')}>{t('템플릿')}</button>
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>{t('기성 라벨 용지')}</button>
        <button className={tab === 'tutorial' ? 'on' : ''} onClick={() => setTab('tutorial')}>{t('튜토리얼')}</button>
      </div>
      {tab === 'tutorial' && <>
        <p className="muted small">{t('처음이라면 예제를 열어 따라 해 보세요. 예제를 열어도 지금 작업은 최근 저장한 작업에 남습니다.')}</p>
        <div className="gallery">
          {LESSONS.map((l, i) => <LessonCard key={l.id} lesson={l} n={i + 1} onPick={pick} />)}
        </div>
      </>}
      {tab === 'stock' && (
        <StockPane
          onBlank={(p) => pick(newProject({ ...p }))}
          onTemplates={(p) => { setStock(p); setSize('stock'); setKind('all'); setTab('templates'); }} />
      )}
      {tab === 'templates' && <>
      <div className="tpl-filter">
        <span className="muted small">{t('용지')}</span>
        <Seg value={kind} onChange={setKind} options={[
          { value: 'all', label: t('전체') },
          ...(Object.keys(PAPER_KIND_LABEL) as PaperKind[]).map((k) => ({ value: k, label: t(PAPER_KIND_LABEL[k]) })),
        ]} />
        <span className="muted small">{t('라벨 크기')}</span>
        <Select value={sizeOk} onChange={setSize} options={[
          { value: 'all', label: t('전체 크기') },
          ...sizes.map((k) => ({ value: k, label: `${k} mm` })),
          { value: 'cur', label: t('현재 용지 · {name} ({size})', { name: tx(current.name), size: labelSize(current) }) },
          ...(stock ? [{ value: 'stock', label: t('기성 용지 · {name}', { name: stock.name }) }] : []),
          ...userPapers.map((p, i) => ({ value: `u${i}`, label: t('내 용지 · {name} ({size})', { name: p.name, size: labelSize(p) }) })),
          { value: 'custom', label: t('크기 직접 입력…') },
        ]} />
        <span className="muted small">{t('{n}개 템플릿', { n: shown.length })}</span>
      </div>
      {sizeOk === 'custom' && (
        <div className="tpl-filter">
          <Num label={t('폭')} value={custom.w} step={0.5} min={5} max={1000} unit="mm" width={64} onChange={(w) => setCustom({ ...custom, w })} />
          <Num label={t('높이')} value={custom.h} step={0.5} min={5} max={1000} unit="mm" width={64} onChange={(h) => setCustom({ ...custom, h })} />
          <Seg value={custom.page} onChange={(page) => setCustom({ ...custom, page })} options={[
            { value: 'roll', label: t('낱장·롤'), title: t('라벨 한 장 크기의 용지') },
            { value: 'A4', label: t('A4에 채우기') },
            { value: 'Letter', label: t('Letter에 채우기') },
          ]} />
          {custom.page !== 'roll' && <Num label={t('간격')} value={custom.gap} step={0.5} min={0} unit="mm" width={56} onChange={(gap) => setCustom({ ...custom, gap })} />}
          <span className="muted small">{override.name}{override.cols * override.rows > 1 ? ` · ${t('{n}칸', { n: override.cols * override.rows })}` : ''}</span>
        </div>
      )}
      {override && <p className="muted small">{override.preprint ? t('모든 템플릿을 이 크기에 맞춰 늘이거나 줄여 만듭니다 (견출지는 입력 영역 안에 배치). 비율이 많이 다르면 배치를 다듬어 주세요.') : t('모든 템플릿을 이 크기에 맞춰 늘이거나 줄여 만듭니다. 비율이 많이 다르면 배치를 다듬어 주세요.')}</p>}
      <div className="gallery">
        {shown.map(({ t, papers }) => (
          <TemplateCard key={`${t.id}|${kind}|${sizeOk}|${overrideKey}`} t={t} papers={papers} onPick={pick} />
        ))}
      </div>
      </>}
      {recent.length > 0 && (
        <>
          <h3>{t('최근 저장한 작업')}</h3>
          <div className="gallery">
            {recent.map((r) => (
              <button key={r.id} className="card" onClick={() => { onLoad(r.project, r.name); close(); }}>
                <Thumb p={r.project} />
                <strong>{r.name}</strong>
                <span className="muted small">{new Date(r.savedAt).toLocaleString(locale())}</span>
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
    notify(t('현장 등록 완료'));
    printOne(row.id, next);
    setForm({});
  };

  return (
    <Modal title={t('현장 재발행 · 현장 등록')} onClose={close} wide>
      <Row label={t('출력#mode')}>
        <Seg value={labelPage ? 'label' : 'sheet'} onChange={(v) => setLabelPage(v === 'label')} options={[{ value: 'label', label: t('라벨 크기 1장 (라벨 프린터)') }, { value: 'sheet', label: t('현재 용지의 칸 지정') }]} />
        {!labelPage && <Num value={cell} step={1} min={1} max={project.paper.cols * project.paper.rows} onChange={setCell} unit={t('번째 칸')} width={130} />}
      </Row>
      <h3>{t('재발행 — 이름·소속·ID로 찾기')}</h3>
      <input type="search" autoFocus placeholder={t('검색어 입력…')} value={q} onChange={(e) => setQ(e.target.value)} className="wide-input" />
      <ul className="hits">
        {hits.map(({ r, i }) => (
          <li key={r.id}>
            <span className="idx">{i + 1}</span>
            <span className="ellipsis">{cols.slice(0, 4).map((c) => r.values[c]).filter(Boolean).join(' · ')}</span>
            <span className={`status ${r.printed ? 'done' : ''}`}>{r.printed ? t('출력 {time}', { time: new Date(r.printed).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : t('미출력')}</span>
            <button className="primary" onClick={() => printOne(r.id)}>{t('인쇄')}</button>
          </li>
        ))}
        {q && !hits.length && <li className="muted">{t('찾는 사람이 없습니다. 아래에서 현장 등록하세요.')}</li>}
      </ul>
      <h3>{t('현장 등록 — 새 참가자 추가 후 바로 인쇄')}</h3>
      {cols.length ? (
        <div className="grid2">
          {cols.map((c) => <Row key={c} label={c}><input value={form[c] ?? ''} onChange={(e) => setForm({ ...form, [c]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && register()} /></Row>)}
        </div>
      ) : <p className="muted">{t('데이터 열이 없습니다. 먼저 명단을 가져오거나 열을 추가하세요.')}</p>}
      <div className="btn-row"><span className="spacer" /><button className="primary" disabled={!cols.length} onClick={register}>{t('등록하고 인쇄')}</button></div>
    </Modal>
  );
}

/* ---------- calibration ---------- */

export function CalibrationDialog() {
  const cal = useStore((s) => s.project.calibration);
  const { close, commit } = useStore.getState();
  const up = (p: Partial<typeof cal>) => commit((x) => ({ ...x, calibration: { ...x.calibration, ...p } }));
  return (
    <Modal title={t('프린터 정렬 보정')} onClose={close} footer={<><button onClick={() => up({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 })}>{t('초기화')}</button><span className="spacer" /><button className="primary" onClick={close}>{t('완료')}</button></>}>
      <ol className="steps">
        <li>{tn('인쇄 · 내보내기 창의 {page}를 일반 용지에 인쇄합니다 (배율 100%, "실제 크기").', { page: <b>{t('정렬 테스트 페이지')}</b> })}</li>
        <li>{t('라벨지 위에 겹쳐 보거나 자로 재어 테두리가 어긋난 만큼 아래에 입력합니다.')}</li>
        <li>{t('오른쪽/아래로 밀려 나오면 음수, 왼쪽/위로 치우치면 양수를 넣습니다. 50 mm 눈금이 실제와 다르면 배율을 고칩니다.')}</li>
      </ol>
      <div className="grid2">
        <Num label={t('X 이동')} value={cal.offsetX} step={0.1} unit="mm" onChange={(v) => up({ offsetX: v })} />
        <Num label={t('Y 이동')} value={cal.offsetY} step={0.1} unit="mm" onChange={(v) => up({ offsetY: v })} />
        <Num label={t('X 배율')} value={cal.scaleX * 100} step={0.1} unit="%" onChange={(v) => up({ scaleX: v / 100 })} />
        <Num label={t('Y 배율')} value={cal.scaleY * 100} step={0.1} unit="%" onChange={(v) => up({ scaleY: v / 100 })} />
      </div>
      <div className="cal-graphics">
        <SignGuide />
        <AlignScope x={cal.offsetX} y={cal.offsetY} />
      </div>
      <p className="muted small">{t('보정값은 프로젝트에 저장되며 인쇄·PDF 출력에 적용됩니다 (내보내기 창에서 끌 수 있음).')}</p>
    </Modal>
  );
}

// fixed paper colours: the graphics stand for the printout, so they stay the same in dark mode
const CAL_RED = '#dc2626', CAL_INK = '#111827', CAL_FIX = '#2563eb';

function arrow(x1: number, y1: number, x2: number, y2: number, color: string, head = 5) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const pt = (d: number) => `${x2 - head * Math.cos(a + d)},${y2 - head * Math.sin(a + d)}`;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2 - head * 0.7 * Math.cos(a)} y2={y2 - head * 0.7 * Math.sin(a)} stroke={color} strokeWidth={1.2} />
      <polygon points={`${x2},${y2} ${pt(0.45)} ${pt(-0.45)}`} fill={color} />
    </g>
  );
}

const cross = (x: number, y: number, r: number, color: string, w = 1.4) => (
  <path d={`M${x - r} ${y}H${x + r}M${x} ${y - r}V${y + r}`} stroke={color} strokeWidth={w} fill="none" />
);

/** Which way the print has to be off for a negative or a positive value. */
function SignGuide() {
  const panel = (dx: number, dy: number, title: string, sign: string) => (
    <figure className="cal-sign">
      <svg viewBox="0 0 100 70" width={120} height={84} role="img" aria-label={title}>
        <rect x={0.5} y={0.5} width={99} height={69} rx={4} fill="#fff" stroke="#e5e7eb" />
        <rect x={22} y={13} width={56} height={40} rx={3} fill="#f3f4f6" stroke="#9ca3af" />
        {cross(50, 33, 6, CAL_RED)}
        <rect x={22 + dx} y={13 + dy} width={56} height={40} rx={3} fill="none" stroke={CAL_INK} strokeDasharray="3 2" />
        {cross(50 + dx, 33 + dy, 6, CAL_INK)}
        {arrow(50 + dx * 0.9, 33 + dy * 0.9, 50 + dx * 0.15, 33 + dy * 0.15, CAL_FIX, 4)}
      </svg>
      <figcaption>{title}<b>{sign}</b></figcaption>
    </figure>
  );
  return (
    <div className="cal-signs">
      {panel(9, 7, t('인쇄가 오른쪽·아래로 밀림'), t('X −, Y − 입력'))}
      {panel(-9, -7, t('인쇄가 왼쪽·위로 치우침'), t('X +, Y + 입력'))}
    </div>
  );
}

const SCOPE_RANGES = [0.5, 1, 2, 5, 10, 20, 50, 100];

/**
 * Reticle for the entered offset: the red cross is the label's centre on the label sheet, the black
 * one where the printer puts it without correction (the opposite of the offset, which moves the print).
 */
function AlignScope({ x, y }: { x: number; y: number }) {
  const ex = -x || 0, ey = -y || 0;
  const big = Math.max(Math.abs(ex), Math.abs(ey));
  const R = SCOPE_RANGES.find((r) => big <= r * 0.9) ?? SCOPE_RANGES[SCOPE_RANGES.length - 1];
  const k = 88 / R; // px per mm, the scope is 200 px wide with the centre at 0
  const clamp = (v: number) => Math.max(-94, Math.min(94, v));
  const px = clamp(ex * k), py = clamp(ey * k);
  const mm = (v: number) => String(Math.round(Math.abs(v) * 100) / 100);
  const lines = [];
  for (let i = -10; i <= 10; i++) {
    const v = (i * 88) / 10, major = i % 5 === 0;
    const stroke = i === 0 ? '#9ca3af' : major ? '#d1d5db' : '#f0f1f3';
    lines.push(<line key={`v${i}`} x1={v} y1={-96} x2={v} y2={96} stroke={stroke} strokeWidth={0.8} />, <line key={`h${i}`} x1={-96} y1={v} x2={96} y2={v} stroke={stroke} strokeWidth={0.8} />);
    if (i === 0) continue;
    // ticks on the axes, like a rifle scope
    const tl = major ? 5 : 2.5;
    lines.push(<path key={`t${i}`} d={`M${v} ${-tl}V${tl}M${-tl} ${v}H${tl}`} stroke="#6b7280" strokeWidth={0.8} />);
    if (major) {
      const label = String((i * R) / 10).replace('-', '−');
      lines.push(
        <text key={`lx${i}`} x={v} y={13} fontSize={7} textAnchor="middle" fill="#6b7280">{label}</text>,
        <text key={`ly${i}`} x={-7} y={v + 2.5} fontSize={7} textAnchor="end" fill="#6b7280">{label}</text>,
      );
    }
  }
  const parts: string[] = [];
  if (Math.abs(ex) >= 0.005) parts.push(t(ex > 0 ? '오른쪽 {v} mm' : '왼쪽 {v} mm', { v: mm(ex) }));
  if (Math.abs(ey) >= 0.005) parts.push(t(ey > 0 ? '아래 {v} mm' : '위 {v} mm', { v: mm(ey) }));
  const off = parts.length > 0;
  return (
    <figure className="cal-scope">
      <svg viewBox="-100 -100 200 200" width={200} height={200} role="img" aria-label={t('입력값으로 본 어긋남')}>
        <rect x={-99.5} y={-99.5} width={199} height={199} rx={6} fill="#fff" stroke="#e5e7eb" />
        {lines}
        <circle r={44} fill="none" stroke="#e5e7eb" strokeWidth={0.8} />
        <circle r={88} fill="none" stroke="#e5e7eb" strokeWidth={0.8} />
        {off && <path d={`M${px} ${py}V0M${px} ${py}H0`} stroke={CAL_INK} strokeWidth={0.7} strokeDasharray="2 2" opacity={0.5} />}
        {off && Math.hypot(px, py) > 16 && arrow(px * 0.88, py * 0.88, px * 0.12, py * 0.12, CAL_FIX)}
        {cross(0, 0, 12, CAL_RED, 1.6)}
        <circle r={2} fill="none" stroke={CAL_RED} strokeWidth={1} />
        {cross(px, py, 12, CAL_INK, 1.6)}
        <text x={-94} y={-88} fontSize={7} fill="#6b7280">mm</text>
      </svg>
      <figcaption>
        <div><b>{t('보정 전 인쇄 위치')}</b>: {off ? parts.join(' · ') : t('어긋남 없음')}</div>
        <div className="cal-legend">
          <span><i style={{ background: CAL_RED }} />{t('라벨지의 라벨 중심')}</span>
          <span><i style={{ background: CAL_INK }} />{t('보정 전 인쇄된 십자선')}</span>
          <span><i style={{ background: CAL_FIX }} />{t('입력값만큼 옮겨 맞춤')}</span>
        </div>
        <div className="muted small">{t('한 눈금 {v} mm', { v: String(R / 10) })}</div>
      </figcaption>
    </figure>
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
    notify(t('"{name}" 글꼴을 내장했습니다.', { name: f.family }));
  };
  const upload = async () => {
    const file = await pickFile('.ttf,.otf,.woff,.woff2');
    if (!file) return;
    const family = prompt(t('글꼴 이름 (디자인에서 쓸 이름)'), file.name.replace(/\.(ttf|otf|woff2?)$/i, ''));
    if (!family) return;
    await add(await fontFromFile(file, family));
  };
  const loadLocal = async () => {
    const list = await queryLocalFonts();
    const fams = [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b, getLang()));
    (window as unknown as { __localFonts?: string[] }).__localFonts = fams;
    (window as unknown as { __localFontData?: typeof list }).__localFontData = list;
    window.dispatchEvent(new Event('labelloom:fonts'));
    setLocal(fams);
    if (!fams.length) notify(t('글꼴 목록을 가져오지 못했습니다 (권한 거부 또는 미지원).'));
  };
  const embedLocal = async () => {
    const data = (window as unknown as { __localFontData?: Awaited<ReturnType<typeof queryLocalFonts>> }).__localFontData ?? [];
    const f = data.find((x) => x.family === pick && /regular|normal|^$/i.test(x.style)) ?? data.find((x) => x.family === pick);
    if (!f) return;
    await add(await fontFromFile(await f.blob(), pick));
  };
  const size = (b64: string) => `${((b64.length * 3) / 4 / 1024 / 1024).toFixed(2)} MB`;
  return (
    <Modal title={t('글꼴 관리')} onClose={close} wide footer={<><span className="spacer" /><button className="primary" onClick={close}>{t('닫기')}</button></>}>
      <p className="muted">{tn('글꼴 파일을 프로젝트에 내장하면 다른 컴퓨터에서 열어도 같은 글꼴로 보이고, {ttf} 글꼴은 PDF에 벡터 텍스트로 들어갑니다.', { ttf: <b>TTF</b> })}</p>
      <h3>{t('내장된 글꼴 ({n})', { n: fonts.length })}</h3>
      <ul className="font-list">
        {fonts.map((f) => (
          <li key={f.family}>
            <span style={{ fontFamily: `"${f.family}"` }} className="font-sample">{f.family} {t('가나다 ABC 123')}</span>
            <span className="muted small">{f.format} · {size(f.data)}</span>
            {f.format === 'truetype' ? <span className="ok small">{t('PDF 벡터')}</span> : <span className="muted small">{t('PDF 이미지')}</span>}
            <button className="icon tiny" onClick={() => commit((p) => ({ ...p, fonts: p.fonts.filter((x) => x.family !== f.family) }))}>✕</button>
          </li>
        ))}
        {!fonts.length && <li className="muted">{t('없음')}</li>}
      </ul>
      <div className="btn-row"><button onClick={upload}>{t('글꼴 파일 추가 (TTF·OTF·WOFF)…')}</button></div>
      <h3>{t('이 컴퓨터의 글꼴')}</h3>
      {localFontsSupported() ? (
        <>
          <div className="btn-row">
            <button onClick={loadLocal}>{t('글꼴 목록 불러오기')}</button>
            {local.length > 0 && <span className="muted small">{t('{n}개 — 글꼴 입력란 자동완성에 추가됨', { n: local.length })}</span>}
          </div>
          {local.length > 0 && (
            <div className="btn-row">
              <select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">{t('글꼴 선택…')}</option>{local.map((f) => <option key={f}>{f}</option>)}</select>
              <button disabled={!pick} onClick={embedLocal}>{t('프로젝트에 내장')}</button>
            </div>
          )}
        </>
      ) : <p className="muted small">{t('이 브라우저는 로컬 글꼴 목록을 지원하지 않습니다 (Chrome/Edge에서 지원). 글꼴 이름을 직접 입력해도 설치된 글꼴이면 사용됩니다.')}</p>}
    </Modal>
  );
}

/* ---------- shortcuts ---------- */

/** Keys whose names have words in them are translated too (휠 = wheel, 드래그 = drag). */
const KEYS: [Msg | string, Msg][] = [
  ['V / T / R / O / L / B / Q / I', m('선택 / 텍스트 / 사각형 / 원 / 선 / 바코드 / QR / 이미지 도구')],
  ['Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y', m('실행 취소 / 다시 실행')],
  ['Ctrl+C / X / V / D', m('복사 / 잘라내기 / 붙여넣기 / 복제')],
  ['Delete, Backspace', m('삭제')],
  [m('방향키 (Shift)'), m('0.5 mm (5 mm) 이동')],
  ['Ctrl+A', m('모두 선택')],
  ['Ctrl+G / Ctrl+Shift+G', m('그룹 / 그룹 해제')],
  ['Ctrl+] / Ctrl+[ (Shift)', m('앞으로 / 뒤로 (맨 앞 / 맨 뒤)')],
  ['Ctrl+S / Ctrl+Shift+S', m('저장 / 다른 이름으로 저장')],
  ['Ctrl+O', m('열기')],
  ['Ctrl+P', m('인쇄 · 내보내기')],
  ['F1', m('튜토리얼·도움말')],
  [m('Ctrl+휠, Ctrl+= / Ctrl+-'), m('확대 / 축소')],
  ['Ctrl+0', m('화면에 맞추기')],
  ['Ctrl+Shift+0', m('폭에 맞추기')],
  [m('Space+드래그, 휠'), m('화면 이동')],
  [m('Shift+드래그'), m('수평/수직 이동, 비율 유지 크기 조절, 15° 회전')],
  [m('Alt+드래그'), m('스냅 끄기')],
  [m('Ctrl/Alt+클릭'), m('그룹 안의 개체 하나만 선택')],
  [m('오른쪽 클릭'), m('개체 메뉴 (순서, 정렬, 잠금 등) · 빈 곳에서는 그 자리에 붙여넣기')],
  ['PageUp / PageDown', m('이전 / 다음 데이터 행 미리보기')],
  ['Esc', m('선택 해제 / 선택 도구')],
  [m('표 더블클릭, Enter'), m('표 칸 편집 시작 (바로 입력하면 칸이 채워짐)')],
  [m('표: Enter / Tab / 방향키'), m('아래 칸 / 다음 칸 / 칸 이동 (Shift로 여러 칸)')],
  [m('표: Alt+Enter, F2'), m('칸 안 줄바꿈 / 칸 내용 고치기')],
  [m('표: Ctrl+C / V, Delete'), m('칸 복사 / 엑셀 표 붙여넣기, 내용 지우기')],
  [m('표: Esc'), m('칸 입력 취소 → 표 편집 끝내기')],
];

export function ShortcutsDialog() {
  const { close } = useStore.getState();
  return (
    <Modal title={t('단축키')} onClose={close}>
      <table className="keys"><tbody>{KEYS.map(([k, v]) => <tr key={k}><td><kbd>{tx(k)}</kbd></td><td>{t(v)}</td></tr>)}</tbody></table>
    </Modal>
  );
}

/* ---------- about (content lives in src/about.json) ---------- */

const linked = (text: string, url?: string): ReactNode =>
  url ? <a href={url} target="_blank" rel="noreferrer">{text}</a> : text;

export function AboutDialog() {
  const { close } = useStore.getState();
  const info = [
    ...ABOUT.info.filter((r) => loc(r.value)).map((r) => ({ label: loc(r.label), value: loc(r.value), url: r.url, build: false })),
    { label: t('버전'), value: `v${VERSION}`, url: '', build: false },
    { label: t('빌드'), value: BUILD_DATE, url: '', build: true },
  ];
  const credits = ABOUT.credits.filter((c) => c.name);
  const [text, setText] = useState<'own' | 'third' | null>(null);
  const toggle = (t: 'own' | 'third') => setText(text === t ? null : t);
  return (
    <Modal title={t('프로그램 정보')} onClose={close}>
      <div className="about">
        <div className="about-head">
          <h3>{ABOUT.name}</h3>
          {loc(ABOUT.subtitle) && <div className="muted">{loc(ABOUT.subtitle)}</div>}
        </div>
        {loc(ABOUT.description) && <p className="about-text">{loc(ABOUT.description)}</p>}
        <table className="keys"><tbody>
          {info.map((r) => (
            <tr key={r.label}><td className="muted">{r.label}</td><td title={r.build ? BUILD_DETAIL : undefined}>{linked(r.value, r.url)}</td></tr>
          ))}
        </tbody></table>
        {loc(ABOUT.notice) && <p className="about-text">{loc(ABOUT.notice)}</p>}
        {credits.length > 0 && <>
          <h4>{t('사용한 오픈소스')}</h4>
          <table className="keys small"><tbody>
            {credits.map((c) => <tr key={c.name}><td>{linked(c.name, c.url)}</td><td className="muted">{loc(c.license)}</td></tr>)}
          </tbody></table>
        </>}
        {ABOUT.copyright && <p className="muted small">{ABOUT.copyright}</p>}
        <div className="row-btns">
          <button className={text === 'own' ? 'on' : ''} onClick={() => toggle('own')}>{t('LabelLoom 라이선스 전문')}</button>
          <button className={text === 'third' ? 'on' : ''} onClick={() => toggle('third')}>{t('오픈소스 라이선스 전문')}</button>
        </div>
        {text && <pre className="license-text">{text === 'own' ? OWN_LICENSE : THIRD_PARTY_LICENSES}</pre>}
      </div>
    </Modal>
  );
}
