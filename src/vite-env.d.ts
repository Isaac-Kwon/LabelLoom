/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Commit SHA, set by the GitHub Pages workflow. Absent in local builds. */
  readonly VITE_COMMIT_SHA?: string;
}

/** ISO timestamp of the build, injected by vite.config.ts. */
declare const __BUILD_TIME__: string;
