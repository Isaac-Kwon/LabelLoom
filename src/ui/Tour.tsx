import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import type { Project } from '../model/types';
import { useStore } from '../store';
import { LESSONS, lessonProject, stepText, type Lesson } from '../tutorial/lessons';

/** Open the lesson's example and walk through its steps. */
export function startTour(lesson: Lesson, onLoad: (p: Project) => void) {
  const s = useStore.getState();
  onLoad(lessonProject(lesson));
  s.close();
  s.setTour({ lesson: lesson.id, step: 0 });
}

const CARD_W = 320;
const GAP = 10;

interface Box { x: number; y: number; w: number; h: number }
const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/**
 * Guided tour: a ring around the element the step names (data-tour) and a card next to it.
 * Nothing covers the page, so people do the step themselves; a step with `done` moves on
 * once the store says it is done, the others wait for 다음.
 */
export function Tour() {
  const tour = useStore((s) => s.tour);
  const lesson = tour && LESSONS.find((l) => l.id === tour.lesson);
  const step = lesson?.steps[tour!.step];
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(160);
  const card = useRef<HTMLDivElement>(null);

  // follow the target: it can appear late (a dialog, a selection), move or scroll
  useEffect(() => {
    if (!step?.target) { setBox(null); return; }
    let scrolled = false;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      const r = el?.getBoundingClientRect();
      if (!el || !r || !r.width) { setBox((b) => (b === null ? b : null)); return; }
      if (!scrolled) { scrolled = true; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      const next = { x: r.left, y: r.top, w: r.width, h: r.height };
      setBox((b) => (sameBox(b, next) ? b : next));
    };
    find();
    const id = window.setInterval(find, 250);
    window.addEventListener('resize', find);
    return () => { window.clearInterval(id); window.removeEventListener('resize', find); };
  }, [step]);

  // move on when the step is done
  useEffect(() => {
    if (!tour || !step?.done) return;
    const check = useStore.getState;
    let timer = 0;
    const test = () => {
      if (timer || !step.done!(check())) return;
      timer = window.setTimeout(() => useStore.getState().setTour({ ...tour, step: tour.step + 1 }), 500);
    };
    test();
    const unsub = useStore.subscribe(test);
    return () => { unsub(); window.clearTimeout(timer); };
  }, [tour, step]);

  useLayoutEffect(() => { if (card.current) setCardH(card.current.offsetHeight); });

  if (!tour || !lesson || !step) return null;
  const s = useStore.getState();
  const last = tour.step === lesson.steps.length - 1;
  const go = (i: number) => s.setTour({ ...tour, step: i });
  const finish = () => {
    s.setTour(null);
    const next = LESSONS[LESSONS.indexOf(lesson) + 1];
    s.notify(next
      ? t('"{name}" 튜토리얼을 마쳤습니다. 다음 "{next}"은(는) F1에서 시작할 수 있습니다.', { name: t(lesson.title), next: t(next.title) })
      : t('"{name}" 튜토리얼을 마쳤습니다.', { name: t(lesson.title) }));
  };

  // card below the target, else above, else beside it; without a target, low in the middle
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 2 * GAP);
  let left = (vw - w) / 2, top = vh - cardH - 48;
  if (box) {
    left = Math.min(Math.max(GAP, box.x + box.w / 2 - w / 2), vw - w - GAP);
    if (box.y + box.h + GAP + cardH < vh) top = box.y + box.h + GAP;
    else if (box.y - GAP - cardH > 0) top = box.y - GAP - cardH;
    else {
      top = Math.min(Math.max(GAP, box.y), vh - cardH - GAP);
      left = box.x + box.w + GAP + w < vw ? box.x + box.w + GAP : Math.max(GAP, box.x - GAP - w);
    }
  }
  const waiting = !!step.done && !step.done(s);

  return <>
    {box && <div className="tour-ring" style={{ left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8 }} />}
    <div className="tour-card" ref={card} role="dialog" aria-label={t(lesson.title)} style={{ left, top, width: w }}>
      <header>
        <strong>{t(lesson.title)}</strong>
        <span className="muted small">{tour.step + 1} / {lesson.steps.length}</span>
        <button className="icon small" onClick={() => s.setTour(null)} title={t('튜토리얼 끝내기')} aria-label={t('튜토리얼 끝내기')}>✕</button>
      </header>
      <p>{stepText(step)}</p>
      {step.target && !box && <p className="muted small">{t('가리킬 곳이 지금 화면에 없습니다. 앞 단계를 해 보거나 다음으로 넘어가세요.')}</p>}
      <footer>
        {waiting && <span className="muted small">{t('직접 해 보면 다음으로 넘어갑니다')}</span>}
        <span className="spacer" />
        <button disabled={tour.step === 0} onClick={() => go(tour.step - 1)}>{t('이전')}</button>
        {last
          ? <button className="primary" onClick={finish}>{t('마치기')}</button>
          : <button className={waiting ? '' : 'primary'} onClick={() => go(tour.step + 1)}>{waiting ? t('건너뛰기') : t('다음')}</button>}
      </footer>
    </div>
  </>;
}
