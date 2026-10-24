import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { licenses } from './licenses';

const BUILD_TIME = new Date().toISOString();

/** dist/version.json: the installed app compares it with its own build to offer an update (src/pwa.tsx). */
const versionFile = (): Plugin => ({
  name: 'labelloom-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_TIME }) });
  },
});

// Served from https://isaac-kwon.github.io/LabelLoom/. Everything is inlined into dist/index.html, so the file also runs offline.
export default defineConfig({
  base: '/LabelLoom/',
  plugins: [react(), viteSingleFile(), versionFile(), licenses()],
  define: { __BUILD_TIME__: JSON.stringify(BUILD_TIME) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
  },
});
