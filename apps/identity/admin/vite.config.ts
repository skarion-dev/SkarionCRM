import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Cloudflare Pages deploys this app at the site root. Using /admin/ here
  // makes the HTML request /admin/assets/*, which Pages answers with the SPA
  // fallback instead of the JavaScript bundle.
  base: '/',
  server: { port: 5180 },
  build: { outDir: 'dist' },
});
