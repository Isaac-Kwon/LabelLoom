/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Commit SHA, set by the GitHub Pages workflow. Absent in local builds. */
  readonly VITE_COMMIT_SHA?: string;
}

/** ISO timestamp of the build, injected by vite.config.ts. */
declare const __BUILD_TIME__: string;

declare module 'virtual:licenses' {
  /** GNU LGPL-3.0 followed by the GPL-3.0 it builds on (COPYING.LESSER, COPYING). */
  export const OWN_LICENSE: string;
  /** Every bundled npm package with its license text (licenses.ts). */
  export const THIRD_PARTY_LICENSES: string;
}
