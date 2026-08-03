import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5175,
    // Telegram Mini App via cloudflared quick tunnel
    allowedHosts: ['.trycloudflare.com', 'localhost'],
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
