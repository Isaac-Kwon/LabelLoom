import { version } from '../package.json';

const COMMIT = import.meta.env.VITE_COMMIT_SHA?.slice(0, 7);
const BUILT = new Date(__BUILD_TIME__);
const pad = (n: number) => String(n).padStart(2, '0');

export const VERSION = version;
export const BUILD_DATE = `${BUILT.getFullYear()}-${pad(BUILT.getMonth() + 1)}-${pad(BUILT.getDate())} ${pad(BUILT.getHours())}:${pad(BUILT.getMinutes())}`;
export const BUILD_LABEL = `v${version} · ${COMMIT ?? 'dev'} · ${BUILD_DATE}`;
/** Full commit hash and ISO build time, for tooltips. */
export const BUILD_DETAIL = [import.meta.env.VITE_COMMIT_SHA, __BUILD_TIME__].filter(Boolean).join(' · ');
