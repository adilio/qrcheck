import { UrlhausBloom, type UrlhausBloomData } from './bloom';

let cachedFilter: UrlhausBloom | null = null;

/**
 * Load the compact URLHaus host filter (built at deploy time by
 * scripts/prebuild.mjs). ~42 KB versus the 352 KB raw host list it replaces;
 * lookups are O(k) bit probes instead of a linear scan.
 */
export async function loadUrlhausBloom(): Promise<UrlhausBloom> {
  if (cachedFilter) return cachedFilter;
  const { fetchWithLocalCache } = await import('./cache');
  const data = await fetchWithLocalCache<UrlhausBloomData>('/urlhaus/bloom.json', 'urlhaus_bloom');
  cachedFilter = new UrlhausBloom(data);
  return cachedFilter;
}
