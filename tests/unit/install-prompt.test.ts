import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

describe('install-prompt', () => {
  let mockMatchMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockMatchMedia = vi.fn().mockReturnValue({ matches: false });

    Object.defineProperty(global, 'window', {
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        matchMedia: mockMatchMedia,
        localStorage: {
          getItem: vi.fn().mockReturnValue(null),
          setItem: vi.fn(),
          removeItem: vi.fn()
        }
      },
      writable: true,
      configurable: true
    });

    // Also mock global localStorage for direct access
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      },
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes stores with default values', async () => {
    const { deferredPrompt, showInstallPrompt, isInstalled } = await import('../../src/lib/install-prompt');

    expect(get(deferredPrompt)).toBe(null);
    expect(get(showInstallPrompt)).toBe(false);
    expect(get(isInstalled)).toBe(false);
  });

  it('detects standalone mode as installed', async () => {
    mockMatchMedia.mockReturnValue({ matches: true });

    const { initInstallPrompt, isInstalled } = await import('../../src/lib/install-prompt');
    initInstallPrompt();

    expect(get(isInstalled)).toBe(true);
  });

  it('triggerInstallPromptAfterScan shows prompt when deferred prompt exists', async () => {
    const { deferredPrompt, showInstallPrompt, triggerInstallPromptAfterScan, isInstalled } = await import('../../src/lib/install-prompt');

    const mockPrompt = { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) };
    deferredPrompt.set(mockPrompt as any);
    isInstalled.set(false);

    triggerInstallPromptAfterScan();

    expect(get(showInstallPrompt)).toBe(true);
  });

  it('triggerInstallPromptAfterScan does nothing when already installed', async () => {
    const { deferredPrompt, showInstallPrompt, triggerInstallPromptAfterScan, isInstalled } = await import('../../src/lib/install-prompt');

    const mockPrompt = { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) };
    deferredPrompt.set(mockPrompt as any);
    isInstalled.set(true);

    triggerInstallPromptAfterScan();

    expect(get(showInstallPrompt)).toBe(false);
  });

  it('triggerInstallPromptAfterScan does nothing when no deferred prompt', async () => {
    const { deferredPrompt, showInstallPrompt, triggerInstallPromptAfterScan, isInstalled } = await import('../../src/lib/install-prompt');

    deferredPrompt.set(null);
    isInstalled.set(false);

    triggerInstallPromptAfterScan();

    expect(get(showInstallPrompt)).toBe(false);
  });

  it('promptInstall returns false when no deferred prompt', async () => {
    const { promptInstall, deferredPrompt } = await import('../../src/lib/install-prompt');

    deferredPrompt.set(null);
    const result = await promptInstall();

    expect(result).toBe(false);
  });

  it('promptInstall calls prompt and handles accepted outcome', async () => {
    const { promptInstall, deferredPrompt, showInstallPrompt } = await import('../../src/lib/install-prompt');

    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' })
    };
    deferredPrompt.set(mockPrompt as any);
    showInstallPrompt.set(true);

    const result = await promptInstall();

    expect(mockPrompt.prompt).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(get(deferredPrompt)).toBe(null);
    expect(get(showInstallPrompt)).toBe(false);
  });

  it('promptInstall handles dismissed outcome', async () => {
    const { promptInstall, deferredPrompt } = await import('../../src/lib/install-prompt');

    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' })
    };
    deferredPrompt.set(mockPrompt as any);

    const result = await promptInstall();

    expect(mockPrompt.prompt).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('dismissInstallPrompt hides prompt', async () => {
    const { dismissInstallPrompt, showInstallPrompt } = await import('../../src/lib/install-prompt');

    showInstallPrompt.set(true);
    expect(get(showInstallPrompt)).toBe(true);

    dismissInstallPrompt();

    expect(get(showInstallPrompt)).toBe(false);
  });
});
