import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeUrl } from '../../src/lib/heuristics';
import type { RedirectExpansion } from '../../src/types';

vi.mock('../../src/lib/expand', () => ({
  expandUrl: vi.fn(async (url: string) => ({
    chain: [url],
    finalUrl: url,
    hops: 0,
    reason: undefined
  }) as RedirectExpansion)
}));

vi.mock('../../src/lib/domainAge', () => ({
  getDomainAge: vi.fn(async () => ({ status: 'unknown', days: null }))
}));

const expandMock = vi.mocked(await import('../../src/lib/expand'));
const domainAgeMock = vi.mocked(await import('../../src/lib/domainAge'));

describe('analyzeUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags non-https URLs', async () => {
    const result = await analyzeUrl('http://example.com/login');
    expect(result.signals.is_https).toBe(false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons).toContain('Not using HTTPS');
  });

  it('adds suspicious TLD score', async () => {
    const result = await analyzeUrl('https://attack.zip/account');
    expect(result.signals.suspicious_tld).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it('detects punycode hosts', async () => {
    const result = await analyzeUrl('https://xn--pple-43d.com');
    expect(result.signals.punycode).toBe(true);
    expect(result.reasons).toContain('Punycode/IDN domain');
  });

  it('detects executable downloads', async () => {
    const result = await analyzeUrl('https://example.com/app.exe');
    expect(result.signals.executable_mime).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('Executable download'))).toBe(true);
  });

  it('detects archive downloads with payload keyword', async () => {
    const result = await analyzeUrl('https://example.com/tool.zip?payload=true');
    expect(result.signals.archive_download).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(40);
  });

  it('penalises unknown shorteners when expansion fails', async () => {
    expandMock.expandUrl.mockResolvedValueOnce({
      chain: ['https://sus.ly/abc'],
      finalUrl: 'https://sus.ly/abc',
      hops: 0,
      reason: 'network_error'
    });
    const result = await analyzeUrl('https://sus.ly/abc');
    expect(result.signals.shortener).toBe('unknown');
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it('penalises multiple redirects', async () => {
    expandMock.expandUrl.mockResolvedValueOnce({
      chain: ['https://a.co', 'https://b.co', 'https://c.co', 'https://d.co'],
      finalUrl: 'https://d.co',
      hops: 3,
      reason: undefined
    });
    const result = await analyzeUrl('https://a.co');
    expect(result.signals.redirect_hops).toBe(3);
    expect(result.reasons).toContain('Multiple redirects (3)');
  });

  it('includes domain age data when fresh', async () => {
    domainAgeMock.getDomainAge.mockResolvedValueOnce({ status: 'ok', days: 12 });
    const result = await analyzeUrl('https://new.site');
    expect(result.signals.domain_age_days).toBe(12);
    expect(result.reasons).toContain('Final domain age 12 days');
  });

  it('marks dangerous schemes', async () => {
    const result = await analyzeUrl('data:text/html;base64,AAAA');
    expect(result.signals.dangerous_scheme).toBe(true);
    expect(result.verdict).toBe('warn');
  });
});
