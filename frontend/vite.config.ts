import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'node:path';

// The microphone API (navigator.mediaDevices) only exists in a secure context —
// localhost is fine over plain HTTP, but a LAN address (192.168.x.x, a phone on
// the same Wi-Fi) needs HTTPS. `npm run dev:secure` sets HTTPS=1 to enable a
// self-signed cert for that case; the default `npm run dev` stays plain HTTP.
const useHttps = process.env.HTTPS === '1';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Forward API calls to the in-repo Express proxy (npm run dev:api).
      // Browser ⇄ Vite is HTTPS when enabled; Vite ⇄ proxy stays HTTP — fine,
      // it's a server-side hop with no mixed-content exposure.
      '/api': {
        target: `http://localhost:${process.env.API_PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
});
