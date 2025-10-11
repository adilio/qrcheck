/**
 * Tests for the URL shortener checker module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  loadShortenerData, 
  checkUrlShortener, 
  checkMultipleUrls, 
  getShortenerMetadata 
} from '../../src/lib/shortener';

// Mock fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock shortener data
const mockShortenerData = {
  domains: [
    'bit.ly',
    'tinyurl.com',
    't.co',
    'ow.ly',
    'is.gd',
    'buff.ly',
    'lnkd.in',
    'short.link',
    'bit.do',
    'mcaf.ee',
    'rebrand.ly',
    'cutt.ly',
    'tiny.cc'
  ],
  patterns: [
    'bit\\.ly',
    'tinyurl\\.com',
    't\\.co',
    'ow\\.ly',
    'is\\.gd',
    'buff\\.ly',
    'lnkd\\.in',
    'short\\.link',
    'bit\\.do',
    'mcaf\\.ee',
    'rebrand\\.ly',
    'cutt\\.ly',
    'tiny\\.cc'
  ],
  metadata: {
    version: '1.0.0',
    lastUpdated: '2025-01-01T00:00:00Z',
    source: 'QRCheck Project'
  }
};

describe('loadShortenerData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load shortener data successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockShortenerData
    });

    const result = await loadShortenerData();
    
    expect(mockFetch).toHaveBeenCalledWith('/shorteners.json');
    expect(result).toEqual(mockShortenerData);
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404
    });

    const result = await loadShortenerData();
    
    expect(result).toEqual({
      domains: [],
      patterns: [],
      metadata: {
        version: '0.0.0',
        lastUpdated: '',
        source: 'fallback'
      }
    });
  });

  it('should handle network errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await loadShortenerData();
    
    expect(result).toEqual({
      domains: [],
      patterns: [],
      metadata: {
        version: '0.0.0',
        lastUpdated: '',
        source: 'fallback'
      }
    });
  });
});

describe('checkUrlShortener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockShortenerData
    });
  });

  it('should identify bit.ly URLs as shorteners', async () => {
    const result = await checkUrlShortener('https://bit.ly/abc123');
    
    expect(result.isShortener).toBe(true);
    expect(result.domain).toBe('bit.ly');
    expect(result.knownServices).toContain('bit.ly');
  });

  it('should identify tinyurl.com URLs as shorteners', async () => {
    const result = await checkUrlShortener('https://tinyurl.com/xyz789');
    
    expect(result.isShortener).toBe(true);
    expect(result.domain).toBe('tinyurl.com');
    expect(result.knownServices).toContain('tinyurl.com');
  });

  it('should identify t.co URLs as shorteners', async () => {
    const result = await checkUrlShortener('https://t.co/def456');
    
    expect(result.isShortener).toBe(true);
    expect(result.domain).toBe('t.co');
    expect(result.knownServices).toContain('t.co');
  });

  it('should identify URLs using subdomains of known shorteners', async () => {
    const result = await checkUrlShortener('https://custom.bit.ly/abc123');
    
    expect(result.isShortener).toBe(true);
    expect(result.domain).toBe('bit.ly');
  });

  it('should not identify regular URLs as shorteners', async () => {
    const result = await checkUrlShortener('https://www.example.com/path/to/page');
    
    expect(result.isShortener).toBe(false);
    expect(result.domain).toBeNull();
  });

  it('should handle invalid URLs gracefully', async () => {
    const result = await checkUrlShortener('not-a-valid-url');
    
    expect(result.isShortener).toBe(false);
    expect(result.domain).toBeNull();
  });

  it('should handle URLs with query parameters', async () => {
    const result = await checkUrlShortener('https://bit.ly/abc123?utm_source=twitter');
    
    expect(result.isShortener).toBe(true);
    expect(result.domain).toBe('bit.ly');
  });

  it('should handle URLs with fragments', async () => {
    const result = await checkUrlShortener('https://bit.ly/abc123#section');
    
    expect(result.isShortener).toBe(true);
    expect(result.domain).toBe('bit.ly');
  });

  it('should be case insensitive for domain matching', async () => {
    const result = await checkUrlShortener('https://BIT.LY/ABC123');
    
    expect(result.isShortener).toBe(true);
    expect(result.domain).toBe('bit.ly');
  });
});

describe('checkMultipleUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockShortenerData
    });
  });

  it('should check multiple URLs and return results for each', async () => {
    const urls = [
      'https://bit.ly/abc123',
      'https://www.example.com/path',
      'https://tinyurl.com/xyz789'
    ];
    
    const results = await checkMultipleUrls(urls);
    
    expect(results.size).toBe(3);
    expect(results.get('https://bit.ly/abc123')?.isShortener).toBe(true);
    expect(results.get('https://www.example.com/path')?.isShortener).toBe(false);
    expect(results.get('https://tinyurl.com/xyz789')?.isShortener).toBe(true);
  });

  it('should handle empty URL list', async () => {
    const urls: string[] = [];
    
    const results = await checkMultipleUrls(urls);
    
    expect(results.size).toBe(0);
  });

  it('should handle a mix of valid and invalid URLs', async () => {
    const urls = [
      'https://bit.ly/abc123',
      'not-a-valid-url',
      'https://tinyurl.com/xyz789'
    ];
    
    const results = await checkMultipleUrls(urls);
    
    expect(results.size).toBe(3);
    expect(results.get('https://bit.ly/abc123')?.isShortener).toBe(true);
    expect(results.get('not-a-valid-url')?.isShortener).toBe(false);
    expect(results.get('https://tinyurl.com/xyz789')?.isShortener).toBe(true);
  });
});

describe('getShortenerMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockShortenerData
    });
  });

  it('should return metadata from the shortener data', async () => {
    const metadata = await getShortenerMetadata();
    
    expect(metadata).toEqual(mockShortenerData.metadata);
    expect(metadata.version).toBe('1.0.0');
    expect(metadata.source).toBe('QRCheck Project');
  });
});