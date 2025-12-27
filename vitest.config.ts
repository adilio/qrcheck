import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    alias: {
      'virtual:pwa-register': '/tests/mocks/pwa-register.ts'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/flags.ts',
        'src/lib/strings.ts',
        'src/lib/pwa.ts', // Uses virtual module, tested via integration
        'src/**/*.d.ts'
      ]
    }
  }
});
