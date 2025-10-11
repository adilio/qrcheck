import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expandUrl } from '../../src/lib/expand';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

function createResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(null, {
    status,
    headers
  });
}

describe('expandUrl', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('returns same URL when no redirects', async () => {
    fetchMock.mockResolvedValue(createResponse(200));
    const result = await expandUrl('https://example.com');
    expect(result.chain).toEqual(['https://example.com/']);
    expect(result.finalUrl).toBe('https://example.com/');
    expect(result.hops).toBe(0);
  });

  it('follows redirects up to max hops', async () => {
    fetchMock
      .mockResolvedValueOnce(createResponse(301, { Location: 'https://b.example' }))
      .mockResolvedValueOnce(createResponse(302, { Location: 'https://c.example' }))
      .mockResolvedValue(createResponse(200));

    const result = await expandUrl('https://a.example');
    expect(result.chain).toEqual(['https://a.example/', 'https://b.example/', 'https://c.example/']);
    expect(result.hops).toBe(2);
  });

  it('stops on redirect loop', async () => {
    fetchMock.mockResolvedValue(createResponse(302, { Location: 'https://loop.example' }));
    const result = await expandUrl('https://loop.example');
    expect(result.reason).toBe('redirect_loop');
  });

  it('returns unsupported for non-http scheme', async () => {
    const result = await expandUrl('ftp://example.com/file');
    expect(result.reason).toBe('unsupported_scheme');
  });
});
