import { describe, expect, it } from 'vitest';
import { TTLCache } from '../../src/lib/cache';

describe('TTLCache', () => {
  it('stores and retrieves values', async () => {
    const cache = new TTLCache<{ foo: string }>({ dbName: 'test', storeName: 'store', maxAgeMs: 1000 });
    await cache.set('a', { foo: 'bar' });
    const value = await cache.get('a');
    expect(value).toEqual({ foo: 'bar' });
  });

  it('expires values after ttl', async () => {
    const cache = new TTLCache<{ foo: string }>({ dbName: 'test', storeName: 'store2', maxAgeMs: 1 });
    await cache.set('a', { foo: 'bar' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const value = await cache.get('a');
    expect(value).toBeUndefined();
  });
});
