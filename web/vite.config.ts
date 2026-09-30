import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em desenvolvimento, a tela (4001) repassa /api para o servidor do painel
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 4001,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
