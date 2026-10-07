import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // In dev, /api is proxied to the Node server (no CORS needed).
    proxy: { '/api': { target: process.env.VITE_DEV_PROXY ?? 'http://localhost:8080', changeOrigin: true } },
  },
  test: { include: ['src/**/*.test.ts'] },
});
