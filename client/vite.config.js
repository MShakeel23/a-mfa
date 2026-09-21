import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // expose on LAN (still needs HTTPS for WebAuthn on phones)
    allowedHosts: ['.trycloudflare.com'], // quick-tunnel domains
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
