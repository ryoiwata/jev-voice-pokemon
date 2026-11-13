import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { fs: { allow: ['..'] }, proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true }, '/mcp': 'http://127.0.0.1:8787', '/pic': 'http://127.0.0.1:8787' } },
});
