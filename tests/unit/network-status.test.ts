import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

describe('network-status', () => {
  let originalNavigator: Navigator;
  let originalWindow: Window & typeof globalThis;

  beforeEach(() => {
    originalNavigator = global.navigator;
    originalWindow = global.window;
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', { value: originalNavigator, writable: true });
    vi.restoreAllMocks();
  });

  it('initializes with navigator.onLine value when true', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { onLine: true },
      writable: true
    });

    const { online } = await import('../../src/lib/network-status');
    expect(get(online)).toBe(true);
  });

  it('initializes with navigator.onLine value when false', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { onLine: false },
      writable: true
    });

    const { online } = await import('../../src/lib/network-status');
    expect(get(online)).toBe(false);
  });

  it('updates store on online event', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { onLine: false },
      writable: true
    });

    const listeners: Record<string, EventListener> = {};
    Object.defineProperty(global, 'window', {
      value: {
        addEventListener: (event: string, listener: EventListener) => {
          listeners[event] = listener;
        },
        removeEventListener: vi.fn()
      },
      writable: true
    });

    const { online } = await import('../../src/lib/network-status');
    expect(get(online)).toBe(false);

    // Simulate online event
    if (listeners['online']) {
      listeners['online'](new Event('online'));
    }
    expect(get(online)).toBe(true);
  });

  it('updates store on offline event', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { onLine: true },
      writable: true
    });

    const listeners: Record<string, EventListener> = {};
    Object.defineProperty(global, 'window', {
      value: {
        addEventListener: (event: string, listener: EventListener) => {
          listeners[event] = listener;
        },
        removeEventListener: vi.fn()
      },
      writable: true
    });

    const { online } = await import('../../src/lib/network-status');
    expect(get(online)).toBe(true);

    // Simulate offline event
    if (listeners['offline']) {
      listeners['offline'](new Event('offline'));
    }
    expect(get(online)).toBe(false);
  });
});
