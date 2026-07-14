import { describe, it, expect, vi } from 'vitest';
import {
  followRedirectChain,
  isPrivateHost,
  isPrivateAddress,
  makeSsrfLookup,
  BLOCKED_CODE
} from '../../functions/resolve';

interface StubResponse {
  status: number;
  headers: { get(name: string): string | null };
}

function redirectTo(location: string): StubResponse {
  return { status: 301, headers: new Headers({ location }) };
}

function finalResponse(status = 200): StubResponse {
  return { status, headers: new Headers() };
}

/** Stub transport with a map of url -> redirect target ('' = final destination). */
function stubChain(routes: Record<string, string>) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = vi.fn(async (url: string, init: { method: string }) => {
    calls.push({ url, method: init.method });
    const target = routes[url];
    if (target === undefined) throw new Error(`Unexpected fetch: ${url}`);
    return target ? redirectTo(target) : finalResponse();
  });
  return { calls, fetchImpl };
}

describe('followRedirectChain', () => {
  it('follows a redirect chain to the final destination', async () => {
    const { fetchImpl } = stubChain({
      'https://short.example/a': 'https://mid.example/b',
      'https://mid.example/b': 'https://real.example/landing',
      'https://real.example/landing': ''
    });

    const result = await followRedirectChain('https://short.example/a', { fetchImpl });

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
    const { fetchImpl } = stubChain({
      'https://a.example/start': '/next',
      'https://a.example/next': ''
    });

    const result = await followRedirectChain('https://a.example/start', { fetchImpl });
    expect(result.resolvedUrl).toBe('https://a.example/next');
    expect(result.partial).toBe(false);
  });

  it('probes with HEAD only and never issues a GET to a destination that answers HEAD', async () => {
    const { calls, fetchImpl } = stubChain({
      'https://short.example/x': 'https://real.example/page',
      'https://real.example/page': ''
    });

    await followRedirectChain('https://short.example/x', { fetchImpl });

    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'HEAD']);
  });

  it('falls back to a 1-byte ranged GET only when the server rejects HEAD (405)', async () => {
    const inits: Array<{ method: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init: { method: string; headers: Record<string, string> }) => {
      inits.push(init);
      if (init.method === 'HEAD') return finalResponse(405);
      return redirectTo('https://real.example/');
    });

    const result = await followRedirectChain('https://headless.example/', {
      fetchImpl: fetchImpl as never,
      maxHops: 2
    });

    expect(inits[0].method).toBe('HEAD');
    expect(inits[1].method).toBe('GET');
    expect(inits[1].headers.range).toBe('bytes=0-0');
    expect(result.hops[1]).toBe('https://real.example/');
  });

  it('treats a non-redirect, non-405/501 HEAD response as final without a GET', async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: { method: string }) => {
      methods.push(init.method);
      return finalResponse(403);
    });

    const result = await followRedirectChain('https://forbidden.example/', { fetchImpl: fetchImpl as never });

    expect(result.partial).toBe(false);
    expect(methods).toEqual(['HEAD']);
  });

  it('detects redirect loops and returns the partial chain', async () => {
    const { fetchImpl } = stubChain({
      'https://a.example/': 'https://b.example/',
      'https://b.example/': 'https://a.example/'
    });

    const result = await followRedirectChain('https://a.example/', { fetchImpl });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('redirect_loop');
    expect(result.hops).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('stops at the hop cap with a max_hops reason', async () => {
    const routes: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      routes[`https://hop.example/${i}`] = `https://hop.example/${i + 1}`;
    }
    const { fetchImpl } = stubChain(routes);

    const result = await followRedirectChain('https://hop.example/0', { maxHops: 5, fetchImpl });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('max_hops');
    expect(result.hops).toHaveLength(5);
  });

  it('aborts a hung hop via the per-hop timeout and keeps the chain so far', async () => {
    const fetchImpl = vi.fn((url: string, init: { signal: AbortSignal }) => {
      if (url === 'https://fast.example/') {
        return Promise.resolve(redirectTo('https://slow.example/'));
      }
      return new Promise<StubResponse>((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
      });
    });

    const result = await followRedirectChain('https://fast.example/', {
      perHopTimeoutMs: 40,
      fetchImpl: fetchImpl as never
    });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('timeout');
    expect(result.hops).toEqual(['https://fast.example/', 'https://slow.example/']);
  });

  it('stops at the overall deadline', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      await new Promise((r) => setTimeout(r, 30));
      const n = Number(url.split('/').pop());
      return redirectTo(`https://slowchain.example/${n + 1}`);
    });

    const result = await followRedirectChain('https://slowchain.example/0', {
      overallDeadlineMs: 20,
      fetchImpl: fetchImpl as never
    });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('timeout');
    expect(result.hops.length).toBeGreaterThanOrEqual(1);
  });

  it('never fetches a literal private destination mid-chain (SSRF) but records the hop', async () => {
    const { calls, fetchImpl } = stubChain({
      'https://public.example/': 'http://192.168.1.10/admin'
    });

    const result = await followRedirectChain('https://public.example/', { fetchImpl });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('blocked');
    expect(result.hops).toEqual(['https://public.example/', 'http://192.168.1.10/admin']);
    expect(calls.map((c) => c.url)).toEqual(['https://public.example/']);
  });

  it('reports blocked (not network_error) when DNS resolves a hop to private space', async () => {
    // The pinning lookup inside the agent surfaces as a fetch failure whose
    // cause chain carries BLOCKED_CODE — mirror that contract here.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://public.example/') return redirectTo('https://rebind.example/');
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('Refusing to connect'), { code: BLOCKED_CODE })
      });
    });

    const result = await followRedirectChain('https://public.example/', { fetchImpl: fetchImpl as never });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('blocked');
    expect(result.hops).toEqual(['https://public.example/', 'https://rebind.example/']);
  });

  it('treats a network error as a partial result instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await followRedirectChain('https://down.example/', { fetchImpl: fetchImpl as never });

    expect(result.partial).toBe(true);
    expect(result.reason).toBe('network_error');
    expect(result.resolvedUrl).toBe('https://down.example/');
  });
});

describe('makeSsrfLookup', () => {
  type LookupResult = Array<{ address: string; family: number }>;

  function fakeDns(results: Record<string, LookupResult>) {
    return ((hostname: string, _opts: unknown, cb: (err: Error | null, addrs?: LookupResult) => void) => {
      const found = results[hostname];
      if (!found) return cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      cb(null, found);
    }) as never;
  }

  it('pins a public hostname to its validated address', async () => {
    const lookup = makeSsrfLookup(fakeDns({ 'good.example': [{ address: '93.184.216.34', family: 4 }] }));
    const result = await new Promise<{ address?: unknown; family?: number }>((resolve, reject) => {
      lookup('good.example', {}, (err, address, family) =>
        err ? reject(err) : resolve({ address, family }));
    });
    expect(result.address).toBe('93.184.216.34');
    expect(result.family).toBe(4);
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['rfc1918', '10.0.0.5'],
    ['link-local metadata', '169.254.169.254'],
    ['cgnat', '100.64.0.1'],
    ['ipv6 unique-local', 'fd00::1'],
    ['ipv4-mapped loopback', '::ffff:127.0.0.1']
  ])('rejects a hostname resolving to %s with BLOCKED_CODE', async (_label, address) => {
    const family = address.includes(':') ? 6 : 4;
    const lookup = makeSsrfLookup(fakeDns({ 'evil.example': [{ address, family }] }));
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      lookup('evil.example', {}, (e) => resolve(e as NodeJS.ErrnoException));
    });
    expect(err?.code).toBe(BLOCKED_CODE);
  });

  it('rejects when ANY resolved address is private (mixed rebinding response)', async () => {
    const lookup = makeSsrfLookup(fakeDns({
      'mixed.example': [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.1', family: 4 }
      ]
    }));
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      lookup('mixed.example', {}, (e) => resolve(e as NodeJS.ErrnoException));
    });
    expect(err?.code).toBe(BLOCKED_CODE);
  });

  it('propagates DNS resolution failures', async () => {
    const lookup = makeSsrfLookup(fakeDns({}));
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      lookup('missing.example', {}, (e) => resolve(e as NodeJS.ErrnoException));
    });
    expect(err?.code).toBe('ENOTFOUND');
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.255.255.254', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.0.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['100.127.255.255', true],
    ['100.128.0.1', false],
    ['0.0.0.0', true],
    ['224.0.0.251', true],
    ['255.255.255.255', true],
    ['198.18.0.1', true],
    ['8.8.8.8', false],
    ['93.184.216.34', false],
    ['::1', true],
    ['::', true],
    ['fe80::1', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['ff02::1', true],
    ['::ffff:192.168.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['64:ff9b::7f00:1', true],
    ['2001:db8::1', true],
    ['2606:4700::1111', false]
  ])('%s -> %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe('isPrivateHost', () => {
  it.each([
    ['127.0.0.1', true],
    ['localhost', true],
    ['sub.localhost', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.0.1', true],
    ['169.254.1.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['[::1]', true],
    ['example.com', false],
    ['8.8.8.8', false]
  ])('%s -> %s', (host, expected) => {
    expect(isPrivateHost(host)).toBe(expected);
  });
});
