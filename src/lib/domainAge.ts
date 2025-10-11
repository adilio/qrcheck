import { TTLCache } from './cache';

interface DomainAgeResponse {
  domain: string;
  createdAt: string;
  ageDays: number;
}

export type DomainAgeStatus = 'ok' | 'unknown' | 'error';

export interface DomainAgeResult {
  status: DomainAgeStatus;
  days: number | null;
}

const CACHE = new TTLCache<DomainAgeResult>({
  dbName: 'qrcheck-cache',
  storeName: 'domain-intel',
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxEntries: 200
});

const DEFAULT_ENDPOINT = import.meta.env.VITE_DOMAIN_AGE_ENDPOINT;

export interface DomainAgeOptions {
  endpoint?: string;
  bypassCache?: boolean;
}

function registrableDomain(host: string): string {
  const normalized = host.toLowerCase();
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }
  // rudimentary PSL approximation: retain last two labels, but keep ccTLDs like co.uk
  const secondLevel = parts[parts.length - 2];
  const tld = parts[parts.length - 1];
  const pseudoPublicSuffixes = new Set(['co', 'com', 'net', 'org', 'gov']);
  if (pseudoPublicSuffixes.has(secondLevel) && parts.length >= 3) {
    return `${parts[parts.length - 3]}.${secondLevel}.${tld}`;
  }
  return `${secondLevel}.${tld}`;
}

export async function getDomainAge(host: string, options: DomainAgeOptions = {}): Promise<DomainAgeResult> {
  const domain = registrableDomain(host);
  const cacheKey = domain;
  if (!options.bypassCache) {
    const cached = await CACHE.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  if (!endpoint) {
    const result: DomainAgeResult = { status: 'unknown', days: null };
    if (!options.bypassCache) {
      await CACHE.set(cacheKey, result);
    }
    return result;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${endpoint}?domain=${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const fallback: DomainAgeResult = { status: 'unknown', days: null };
      if (!options.bypassCache) {
        await CACHE.set(cacheKey, fallback);
      }
      return fallback;
    }

    const data = (await response.json()) as DomainAgeResponse;
    const result: DomainAgeResult = {
      status: 'ok',
      days: typeof data.ageDays === 'number' ? Math.max(0, Math.floor(data.ageDays)) : null
    };
    if (!options.bypassCache) {
      await CACHE.set(cacheKey, result);
    }
    return result;
  } catch {
    const result: DomainAgeResult = { status: 'unknown', days: null };
    if (!options.bypassCache) {
      await CACHE.set(cacheKey, result);
    }
    return result;
  }
}
