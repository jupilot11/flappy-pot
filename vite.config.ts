import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (GitHub Pages, Netlify, etc.)
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  server: { host: true }, // listen on LAN so phones on the same Wi-Fi can open it
});
