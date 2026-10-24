import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Served from https://isaac-kwon.github.io/LabelLoom/. Everything is inlined into dist/index.html, so the file also runs offline.
export default defineConfig({
  base: '/LabelLoom/',
  plugins: [react(), viteSingleFile()],
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
  },
});
