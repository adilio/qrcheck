import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const repoBase =
  process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY.includes('/')
    ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
    : '/';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? repoBase : '/',
  plugins: [svelte()],
  build: { outDir: 'dist', sourcemap: true }
}));
