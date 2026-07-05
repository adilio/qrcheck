import { describe, it, expect } from 'vitest';
import { buildBloomFilter, bloomHas, DEFAULT_FALSE_POSITIVE_RATE } from '../../scripts/bloom.mjs';
import { UrlhausBloom } from '../../src/lib/bloom';

function sampleHosts(count: number, suffix: string): string[] {
  return Array.from({ length: count }, (_, i) => `host-${i}.${suffix}`);
}

describe('bloom filter build/query round trip', () => {
  const hosts = sampleHosts(13_000, 'malware.example');
  const { m, k, bytes } = buildBloomFilter(hosts);

  it('has zero false negatives (every inserted host matches)', () => {
    for (const host of hosts) {
      expect(bloomHas(host, m, k, bytes)).toBe(true);
    }
  });

  it('keeps the false-positive rate near the 1e-4 design target', () => {
    const probes = sampleHosts(100_000, 'benign.example');
    let falsePositives = 0;
    for (const probe of probes) {
      if (bloomHas(probe, m, k, bytes)) falsePositives++;
    }
    const rate = falsePositives / probes.length;
    // Design target is 1e-4; allow generous margin for statistical noise
    expect(rate).toBeLessThan(DEFAULT_FALSE_POSITIVE_RATE * 5);
  });

  it('is dramatically smaller than the raw host list', () => {
    const rawSize = JSON.stringify(hosts).length;
    const filterSize = Buffer.from(bytes).toString('base64').length;
    expect(filterSize).toBeLessThan(rawSize / 5);
  });
});

describe('client UrlhausBloom matches the builder', () => {
  it('reads a base64-serialized filter identically to the builder bytes', () => {
    const hosts = ['evil.example', 'bad.example', 'worse.example'];
    const { m, k, bytes } = buildBloomFilter(hosts);

    const client = new UrlhausBloom({
      updatedAt: '2026-01-01T00:00:00Z',
      count: hosts.length,
      m,
      k,
      bits: Buffer.from(bytes).toString('base64')
    });

    for (const host of hosts) {
      expect(client.has(host)).toBe(true);
    }
    expect(client.has('good.example')).toBe(false);
    // has() normalizes case
    expect(client.has('EVIL.example')).toBe(true);
  });
});
