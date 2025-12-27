import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

describe('pwa', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(global, 'window', {
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      },
      writable: true
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes needRefresh store as false', async () => {
    const { needRefresh } = await import('../../src/lib/pwa');
    expect(get(needRefresh)).toBe(false);
  });

  it('initializes offlineReady store as false', async () => {
    const { offlineReady } = await import('../../src/lib/pwa');
    expect(get(offlineReady)).toBe(false);
  });

  it('registerServiceWorker completes without error', async () => {
    const { registerServiceWorker } = await import('../../src/lib/pwa');

    // Should not throw
    await expect(registerServiceWorker()).resolves.not.toThrow();
  });

  it('updateServiceWorker completes without error when not initialized', async () => {
    const { updateServiceWorker } = await import('../../src/lib/pwa');

    // Should not throw even when update function not set
    await expect(updateServiceWorker()).resolves.not.toThrow();
  });

  it('does nothing in non-browser environment', async () => {
    // @ts-ignore - intentionally delete window for test
    const originalWindow = global.window;
    // @ts-ignore
    delete global.window;

    const { registerServiceWorker } = await import('../../src/lib/pwa');

    // Should complete without error
    await expect(registerServiceWorker()).resolves.not.toThrow();

    // Restore
    global.window = originalWindow;
  });
});
