import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const repoBase = process.env.QRCHECK_BASE ?? './';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? repoBase : '/',
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
}));
