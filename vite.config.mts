import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const repoBase = process.env.QRCHECK_BASE ?? './';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? repoBase : '/',
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  root: '.',
  publicDir: 'public',
  server: {
    fs: {
      // Allow serving files from root
      strict: false
    }
  }
}));
