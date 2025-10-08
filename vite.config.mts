import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const repoBase = process.env.QRCHECK_BASE ?? '/qrcheck/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? repoBase : '/',
  plugins: [svelte()],
  build: { outDir: 'dist', sourcemap: true }
}));
