import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
