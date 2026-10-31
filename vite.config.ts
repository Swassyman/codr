import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const monacoEsm = fileURLToPath(new URL('node_modules/monaco-editor/esm/', import.meta.url));

// The SPA lives in src/web and is served by the Fastify server in production.
// In development Vite proxies /api to the API process on :3000.
export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  resolve: {
    // monaco-vim and monaco-emacs (lazy-loaded key bindings) were written for
    // older Monaco layouts. Point them at the same editor API module the app
    // imports, so they share its instance and never pull in the full
    // monaco-editor entry (every language plus the TypeScript worker).
    alias: [
      { find: /^monaco-editor$/, replacement: `${monacoEsm}vs/editor/editor.api.js` },
      { find: /^monaco-editor\/esm\/(.*?)(\.js)?$/, replacement: `${monacoEsm}$1.js` },
      // Its "browser" export is a UMD build with old Monaco internals inlined.
      { find: /^monaco-vim$/, replacement: fileURLToPath(new URL('node_modules/monaco-vim/dist/index.mjs', import.meta.url)) },
    ],
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000' },
    },
  },
});
