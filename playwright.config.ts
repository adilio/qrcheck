import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: { headless: true, baseURL: 'http://localhost:8888' },
  webServer: {
    command: 'VITE_DEV_MANUAL_URL=true npm run dev:netlify',
    port: 8888,
    reuseExistingServer: false
  },
  testDir: 'tests/e2e',
  timeout: 30000
});
