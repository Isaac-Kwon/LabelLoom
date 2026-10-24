import jsQR from 'jsqr';
import type { Row } from '../model/types';

/**
 * Codes scanned at the desk: from the camera (BarcodeDetector where the browser has it, which reads
 * the common 1D and 2D codes; jsQR otherwise, QR only) or typed by a USB scanner into a text field.
 */

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
type DetectorClass = { new (o?: { formats?: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

export interface Scanner { engine: 'native' | 'qr'; stop(): void }

/** Starts the camera in `video` and calls `onCode` for each code read (the same code at most every 2.5 s). */
export async function startScanner(video: HTMLVideoElement, onCode: (text: string) => void): Promise<Scanner> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  const BD = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  let detector: Detector | null = null;
  if (BD) {
    try {
      const formats = await BD.getSupportedFormats?.();
      detector = new BD(formats?.length ? { formats } : undefined);
    } catch { detector = null; }
  }
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  let live = true, last = '', lastAt = 0;
  const emit = (s: string) => {
    const now = Date.now();
    if (s === last && now - lastAt < 2500) return;
    last = s;
    lastAt = now;
    onCode(s);
  };
  const tick = async () => {
    if (!live) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        if (detector) {
          const r = await detector.detect(video);
          if (r[0]?.rawValue) emit(r[0].rawValue);
        } else {
          const k = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * k);
          canvas.height = Math.round(video.videoHeight * k);
          g.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = g.getImageData(0, 0, canvas.width, canvas.height);
          const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (r?.data) emit(r.data);
        }
      }
    } catch { /* a frame that cannot be read */ }
    if (live) setTimeout(tick, 150);
  };
  void tick();
  return {
    engine: detector ? 'native' : 'qr',
    stop() {
      live = false;
      stream.getTracks().forEach((tr) => tr.stop());
      video.srcObject = null;
    },
  };
}

/**
 * What a scanned code may stand for: the text itself, and for a link its query values, last path
 * segment and fragment (https://…/checkin?id=A123 → A123), for a vCard its name and e-mail.
 */
export function scanCandidates(text: string): string[] {
  const v = text.trim();
  const out = [v];
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      u.searchParams.forEach((x) => out.push(x));
      const seg = u.pathname.split('/').filter(Boolean).pop();
      if (seg) out.push(decodeURIComponent(seg));
      if (u.hash.length > 1) out.push(decodeURIComponent(u.hash.slice(1)));
    } catch { /* not a valid URL after all */ }
  }
  if (/^BEGIN:VCARD/i.test(v)) {
    for (const k of ['FN', 'EMAIL']) {
      const m = v.match(new RegExp(`^${k}(?:;[^:]*)?:(.+)$`, 'im'));
      if (m) out.push(m[1].trim());
    }
  }
  return [...new Set(out.filter(Boolean))];
}

/** Rows with a cell equal to the scanned code (or one of its candidates, in that order). */
export function matchScan(rows: Row[], text: string): Row[] {
  for (const c of scanCandidates(text)) {
    const hits = rows.filter((r) => Object.values(r.values).some((x) => x.trim() === c));
    if (hits.length) return hits;
  }
  return [];
}
