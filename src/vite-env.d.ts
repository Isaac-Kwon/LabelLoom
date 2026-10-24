/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Commit SHA, set by the GitHub Pages workflow. Absent in local builds. */
  readonly VITE_COMMIT_SHA?: string;
}
