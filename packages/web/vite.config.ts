import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn/ui generates imports as `@/components/ui/...` and the CLI writes
    // them that way. The alias has to agree with the `paths` entry in
    // tsconfig.json or Vite resolves what TypeScript cannot, and the build
    // passes while the editor shows errors.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Assets are served by Cloudflare's asset layer, not the Worker, so the
    // bundle size does not eat into the 3 MiB Worker limit. Splitting the
    // vendor chunk still helps first paint.
    rollupOptions: {
      output: {
        // Matched on the resolved path rather than by package name. The
        // name form groups a package's *entry* module and whatever it pulls
        // in — and React 19's `react-dom/client` no longer reaches through
        // `react-dom`'s entry, so `react-dom: ['react-dom']` quietly stopped
        // matching it and 130 kB of the vendor chunk moved into the app
        // chunk, where every deploy re-downloads it.
        manualChunks(id) {
          if (id.includes('/node_modules/xlsx/')) return 'xlsx';
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
