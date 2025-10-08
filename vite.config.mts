import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const repoBase = (() => {
  if (process.env.QRCHECK_BASE) return process.env.QRCHECK_BASE;
  if (process.env.GITHUB_REPOSITORY) {
    const [, repoName] = process.env.GITHUB_REPOSITORY.split('/');
    if (repoName) return `/${repoName}/`;
  }
  if (process.env.GITHUB_ACTIONS) return '/qrcheck/';
  return '/';
})();

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? repoBase : '/',
  plugins: [svelte()],
  build: { outDir: 'dist', sourcemap: true }
}));
