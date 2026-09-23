import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_API_PROXY || 'http://localhost:3001';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/auth': API,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
