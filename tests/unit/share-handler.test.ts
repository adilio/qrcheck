import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('share-handler', () => {
  let mockLocation: { search: string; origin: string };
  let mockHistory: { replaceState: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetModules();
    mockLocation = { search: '', origin: 'https://qrcheck.ca' };
    mockHistory = { replaceState: vi.fn() };

    Object.defineProperty(global, 'window', {
      value: {
        location: mockLocation,
        history: mockHistory
      },
      writable: true
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no share-target param', async () => {
    mockLocation.search = '';

    const { handleShareTarget } = await import('../../src/lib/share-handler');
    const result = handleShareTarget();

    expect(result).toBe(null);
  });

  it('returns null when share-target present but no URL', async () => {
    mockLocation.search = '?share-target';

    const { handleShareTarget } = await import('../../src/lib/share-handler');
    const result = handleShareTarget();

    expect(result).toBe(null);
  });

  it('extracts URL from url param', async () => {
    mockLocation.search = '?share-target&url=https://example.com/page';

    const { handleShareTarget } = await import('../../src/lib/share-handler');
    const result = handleShareTarget();

    expect(result).toBe('https://example.com/page');
    expect(mockHistory.replaceState).toHaveBeenCalledWith({}, '', '/');
  });

  it('extracts URL from text param when url not present', async () => {
    mockLocation.search = '?share-target&text=Check%20this%20https://example.com/test';

    const { handleShareTarget } = await import('../../src/lib/share-handler');
    const result = handleShareTarget();

    expect(result).toBe('https://example.com/test');
  });

  it('handles source=share param', async () => {
    mockLocation.search = '?source=share&url=https://test.com';

    const { handleShareTarget } = await import('../../src/lib/share-handler');
    const result = handleShareTarget();

    expect(result).toBe('https://test.com');
  });

  it('extracts URL from text containing multiple words', async () => {
    mockLocation.search = '?share-target&text=Hey%20check%20this%20out%20http://suspicious.site/login';

    const { handleShareTarget } = await import('../../src/lib/share-handler');
    const result = handleShareTarget();

    expect(result).toBe('http://suspicious.site/login');
  });

  it('returns text as-is when no URL pattern found', async () => {
    mockLocation.search = '?share-target&text=just-some-text-no-url';

    const { handleShareTarget } = await import('../../src/lib/share-handler');
    const result = handleShareTarget();

    expect(result).toBe('just-some-text-no-url');
  });
});

describe('shareResults', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when navigator.share not available', async () => {
    Object.defineProperty(global, 'navigator', {
      value: {},
      writable: true
    });
    Object.defineProperty(global, 'window', {
      value: { location: { origin: 'https://qrcheck.ca' } },
      writable: true
    });

    const { shareResults } = await import('../../src/lib/share-handler');
    const result = await shareResults('https://example.com', 'Safe');

    expect(result).toBe(false);
  });

  it('calls navigator.share with correct params', async () => {
    const mockShare = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global, 'navigator', {
      value: { share: mockShare },
      writable: true
    });
    Object.defineProperty(global, 'window', {
      value: { location: { origin: 'https://qrcheck.ca' } },
      writable: true
    });

    const { shareResults } = await import('../../src/lib/share-handler');
    const result = await shareResults('https://example.com', 'Safe');

    expect(mockShare).toHaveBeenCalledWith({
      title: 'QRCheck Security Report',
      text: 'URL: https://example.com\nVerdict: Safe',
      url: 'https://qrcheck.ca'
    });
    expect(result).toBe(true);
  });

  it('returns false when share is cancelled', async () => {
    const mockShare = vi.fn().mockRejectedValue(new Error('User cancelled'));
    Object.defineProperty(global, 'navigator', {
      value: { share: mockShare },
      writable: true
    });
    Object.defineProperty(global, 'window', {
      value: { location: { origin: 'https://qrcheck.ca' } },
      writable: true
    });

    const { shareResults } = await import('../../src/lib/share-handler');
    const result = await shareResults('https://example.com', 'Safe');

    expect(result).toBe(false);
  });
});
