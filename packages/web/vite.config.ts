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
        manualChunks: {
          react: ['react', 'react-dom'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
