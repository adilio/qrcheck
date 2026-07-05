import { describe, it, expect, vi, afterEach } from 'vitest';
import { lookupDomainAge, registrableDomain, scoreAge } from '../../functions/check-domain-age';

function rdapResponse(createdDaysAgo: number): Response {
  const eventDate = new Date(Date.now() - createdDaysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    ok: true,
    status: 200,
    json: async () => ({
      events: [
        { eventAction: 'registration', eventDate },
        { eventAction: 'last changed', eventDate }
      ]
    })
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registrableDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['www.example.com', 'example.com'],
    ['a.b.deep.example.com', 'example.com'],
    ['news.bbc.co.uk', 'bbc.co.uk'],
    ['EXAMPLE.COM.', 'example.com']
  ])('%s -> %s', (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });
});

describe('scoreAge', () => {
  it('raises risk for very new domains', () => {
    expect(scoreAge(5)).toMatchObject({ risk_points: 20 });
    expect(scoreAge(5).message).toContain('Very new domain');
  });

  it('raises risk moderately for domains under 90 days', () => {
    expect(scoreAge(60)).toMatchObject({ risk_points: 10 });
  });

  it('is neutral for mid-age domains', () => {
    expect(scoreAge(400)).toMatchObject({ risk_points: 0 });
  });

  it('lowers risk for established domains (5y+)', () => {
    const result = scoreAge(6 * 365);
    expect(result.risk_points).toBe(-10);
    expect(result.message).toContain('Established domain');
  });
});

describe('lookupDomainAge', () => {
  it('queries RDAP for the registrable domain and scores a fresh registration', async () => {
    const fetchMock = vi.fn(async () => rdapResponse(10));
    vi.stubGlobal('fetch', fetchMock);

    const result = await lookupDomainAge('www.fresh-phish.example');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://rdap.org/domain/fresh-phish.example',
      expect.anything()
    );
    expect(result.age_days).toBe(10);
    expect(result.risk_points).toBe(20);
  });

  it('caches determinate results per registrable domain', async () => {
    const fetchMock = vi.fn(async () => rdapResponse(4000));
    vi.stubGlobal('fetch', fetchMock);

    const first = await lookupDomainAge('cached.example');
    const second = await lookupDomainAge('www.cached.example');

    expect(first.risk_points).toBe(-10);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrades to unknown when RDAP has no registration event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ events: [] })
    } as unknown as Response)));

    const result = await lookupDomainAge('no-events.example');
    expect(result.age_days).toBeNull();
    expect(result.risk_points).toBe(0);
    expect(result.message).toBe('Domain age could not be determined');
  });

  it('degrades to unknown when the RDAP request fails, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const result = await lookupDomainAge('unreachable.example');
    expect(result.age_days).toBeNull();
    expect(result.risk_points).toBe(0);
  });

  it('does not cache failed lookups', async () => {
    const failing = vi.fn(async () => {
      throw new Error('down');
    });
    vi.stubGlobal('fetch', failing);
    await lookupDomainAge('flaky.example');

    const working = vi.fn(async () => rdapResponse(10));
    vi.stubGlobal('fetch', working);
    const result = await lookupDomainAge('flaky.example');

    expect(result.risk_points).toBe(20);
    expect(working).toHaveBeenCalledTimes(1);
  });
});
