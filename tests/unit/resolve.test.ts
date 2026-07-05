import { describe, it, expect, vi, afterEach } from 'vitest';
import { followRedirectChain, isPrivateHost } from '../../functions/resolve';

function redirectTo(location: string): Response {
  return {
    status: 301,
    headers: new Headers({ location })
  } as unknown as Response;
}

function finalResponse(status = 200): Response {
  return {
    status,
    headers: new Headers()
  } as unknown as Response;
}

/** Stub fetch with a map of url -> redirect target ('' = final destination). */
function stubChain(routes: Record<string, string>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const target = routes[url];
    if (target === undefined) throw new Error(`Unexpected fetch: ${url}`);
    return target ? redirectTo(target) : finalResponse();
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('followRedirectChain', () => {
  it('follows a redirect chain to the final destination', async () => {
    stubChain({
      'https://short.example/a': 'https://mid.example/b',
      'https://mid.example/b': 'https://real.example/landing',
      'https://real.example/landing': ''
    });

    const result = await followRedirectChain('https://short.example/a');

    expect(result.partial).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.resolvedUrl).toBe('https://real.example/landing');
    expect(result.hops).toEqual([
      'https://short.example/a',
      'https://mid.example/b',
      'https://real.example/landing'
    ]);
  });

  it('resolves relative Location headers against the current URL', async () => {
    stubChain({
      'https://a.example/start': '/next',
      'https://a.example/next': ''
    });

    const result = await followRedirectChain('https://a.example/start');
    expect(result.resolvedUrl).toBe('https://a.example/next');
    expect(result.partial).toBe(false);
  });

  it('detects redirect loops and returns the partial chain', async () => {
    stubChain({
      'https://a.example/': 'https://b.example/',
      'https://b.example/': 'https://a.example/'
    });

    const result = await followRedirectChain('https://a.example/');

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('redirect_loop');
    expect(result.hops).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('stops at the hop cap with a max_hops reason', async () => {
    const routes: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      routes[`https://hop.example/${i}`] = `https://hop.example/${i + 1}`;
    }
    stubChain(routes);

    const result = await followRedirectChain('https://hop.example/0', { maxHops: 5 });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('max_hops');
    expect(result.hops).toHaveLength(5);
  });

  it('aborts a hung hop via the per-hop timeout and keeps the chain so far', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      if (url === 'https://fast.example/') {
        return Promise.resolve(redirectTo('https://slow.example/'));
      }
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
      });
    }));

    const result = await followRedirectChain('https://fast.example/', { perHopTimeoutMs: 40 });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('timeout');
    expect(result.hops).toEqual(['https://fast.example/', 'https://slow.example/']);
  });

  it('stops at the overall deadline', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      await new Promise((r) => setTimeout(r, 30));
      const n = Number(url.split('/').pop());
      return redirectTo(`https://slowchain.example/${n + 1}`);
    }));

    const result = await followRedirectChain('https://slowchain.example/0', {
      overallDeadlineMs: 20
    });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('timeout');
    expect(result.hops.length).toBeGreaterThanOrEqual(1);
  });

  it('never fetches a private destination mid-chain (SSRF) but records the hop', async () => {
    const calls = stubChain({
      'https://public.example/': 'http://192.168.1.10/admin'
    });

    const result = await followRedirectChain('https://public.example/');

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('blocked');
    expect(result.hops).toEqual(['https://public.example/', 'http://192.168.1.10/admin']);
    expect(calls).toEqual(['https://public.example/']);
  });

  it('treats a network error as a partial result instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));

    const result = await followRedirectChain('https://down.example/');

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('network_error');
    expect(result.resolvedUrl).toBe('https://down.example/');
  });
});

describe('isPrivateHost', () => {
  it.each([
    ['127.0.0.1', true],
    ['localhost', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.0.1', true],
    ['169.254.1.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['example.com', false],
    ['8.8.8.8', false]
  ])('%s -> %s', (host, expected) => {
    expect(isPrivateHost(host)).toBe(expected);
  });
});
