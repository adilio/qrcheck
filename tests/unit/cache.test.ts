import { afterEach, describe, expect, it, vi } from 'vitest';
import { TTLCache } from '../../src/lib/cache';

afterEach(() => {
  vi.useRealTimers();
});

describe('TTLCache', () => {
  it('stores and retrieves values', async () => {
    const cache = new TTLCache<{ foo: string }>({ dbName: 'test', storeName: 'store', maxAgeMs: 1000 });
    await cache.set('a', { foo: 'bar' });
    const value = await cache.get('a');
    expect(value).toEqual({ foo: 'bar' });
  });

  // Time is driven by a fake clock rather than a real sleep: the TTL check is
  // `now - createdAt > maxAgeMs`, so a real 1ms sleep can observe 0-1ms of
  // elapsed time and read as unexpired.
  it('expires values after ttl', async () => {
    vi.useFakeTimers();
    const cache = new TTLCache<{ foo: string }>({ dbName: 'test', storeName: 'store2', maxAgeMs: 1000 });
    await cache.set('a', { foo: 'bar' });

    vi.setSystemTime(Date.now() + 1001);

    const value = await cache.get('a');
    expect(value).toBeUndefined();
  });

  it('keeps values that are exactly at the ttl boundary', async () => {
    vi.useFakeTimers();
    const cache = new TTLCache<{ foo: string }>({ dbName: 'test', storeName: 'store3', maxAgeMs: 1000 });
    await cache.set('a', { foo: 'bar' });

    vi.setSystemTime(Date.now() + 1000);

    const value = await cache.get('a');
    expect(value).toEqual({ foo: 'bar' });
  });
});
