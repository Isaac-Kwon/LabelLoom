import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

const round = (v: number, step: number) => {
  const d = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(v.toFixed(Math.min(6, d + 1)));
};

/** Numeric input that commits on blur/Enter and supports drag-free arrow stepping. */
export function Num({ label, value, onChange, step = 0.5, min, max, unit, width, title, disabled }: {
  label?: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number;
  unit?: string; width?: number; title?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(String(round(value, step)));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(round(value, step))); }, [value, step]);
  const commit = (s: string) => {
    let v = Number(s.replace(',', '.'));
    if (!Number.isFinite(v)) { setText(String(round(value, step))); return; }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onChange(v);
    setText(String(round(v, step)));
  };
  return (
    <label className="num" title={title} style={width ? { width } : undefined}>
      {label && <span className="num-label">{label}</span>}
      <input
        type="text" inputMode="decimal" value={text} disabled={disabled}
        onFocus={(e) => { focused.current = true; e.target.select(); }}
        onBlur={(e) => { focused.current = false; commit(e.target.value); }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            let v = round((Number(text) || 0) + k, step);
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            setText(String(v));
            onChange(v);
          }
        }}
      />
      {unit && <span className="num-unit">{unit}</span>}
    </label>
  );
}

export function Color({ value, onChange, title, allowNone }: { value: string; onChange: (v: string) => void; title?: string; allowNone?: boolean }) {
  return (
    <span className="color" title={title}>
      <input type="color" value={value && value.startsWith('#') && value.length === 7 ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      <input type="text" className="hex" value={value} placeholder={allowNone ? t('없음') : ''} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

export function Select<T extends string>({ value, onChange, options, title, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[] | readonly { value: T; label: string }[]; title?: string; className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} title={title} className={className}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Check({ label, checked, onChange, title }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[] }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** `tour` names the element for the guided tour (data-tour). */
export function Section({ title, children, actions, defaultOpen = true, tour }: { title: string; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean; tour?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section" data-tour={tour}>
      <header onClick={() => setOpen(!open)}>
        <span className={`caret ${open ? 'open' : ''}`}>▸</span>
        <span className="section-title">{title}</span>
        <span className="section-actions" onClick={(e) => e.stopPropagation()}>{actions}</span>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Row({ children, label, tour }: { children: ReactNode; label?: string; tour?: string }) {
  return <div className="row" data-tour={tour}>{label && <span className="row-label">{label}</span>}{children}</div>;
}

export function Modal({ title, onClose, children, footer, wide, actions }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean | 'xl'; actions?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide === 'xl' ? 'xl' : wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header><h2>{title}</h2>{actions}<button className="icon" onClick={onClose} aria-label={t('닫기')}>✕</button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Progress({ done, total, label }: { done: number; total: number; label?: string }) {
  return (
    <div className="progress">
      <div className="bar"><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      <span>{label} {done}/{total}</span>
    </div>
  );
}

export function DropOverlay({ title, kinds }: { title: string; kinds: string[] }) {
  return (
    <div className="drop-overlay">
      <div className="drop-card">
        <svg className="drop-icon" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 19h14" />
        </svg>
        <strong>{title}</strong>
        <div className="drop-kinds">{kinds.map((k) => <span key={k}>{k}</span>)}</div>
      </div>
    </div>
  );
}
