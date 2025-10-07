import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: { headless: true, baseURL: 'http://localhost:5173' },
  webServer: [
    { command: 'node mocks/api-mock.js', port: 9090, reuseExistingServer: false },
    {
      command: 'VITE_API_BASE=http://localhost:9090 VITE_DEV_MANUAL_URL=true npm run dev',
      port: 5173,
      reuseExistingServer: false
    }
  ],
  testDir: 'tests/e2e',
  timeout: 30000
});
