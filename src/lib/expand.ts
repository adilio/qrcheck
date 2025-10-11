import { TTLCache } from './cache';
import type { ExpansionFailureReason, RedirectExpansion } from '../types';

const MAX_HOPS = 10;
const PER_HOP_TIMEOUT_MS = 1000;
const TOTAL_TIMEOUT_MS = 10_000;
const CACHE = new TTLCache<RedirectExpansion>({
  dbName: 'qrcheck-cache',
  storeName: 'expansion',
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxEntries: 100
});

async function sha256(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(input).digest('hex');
}

function normalizeUrl(url: URL): string {
  url.hash = '';
  return url.toString();
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export interface ExpandOptions {
  bypassCache?: boolean;
}

export async function expandUrl(originalUrl: string, options: ExpandOptions = {}): Promise<RedirectExpansion> {
  const cacheKey = `expansion:${await sha256(originalUrl)}`;
  if (!options.bypassCache) {
    const cached = await CACHE.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  let currentUrl: URL;
  try {
    currentUrl = new URL(originalUrl);
  } catch {
    return {
      chain: [originalUrl],
      finalUrl: originalUrl,
      hops: 0,
      reason: 'unsupported_scheme'
    };
  }

  if (!['http:', 'https:'].includes(currentUrl.protocol)) {
    const result = {
      chain: [normalizeUrl(currentUrl)],
      finalUrl: normalizeUrl(currentUrl),
      hops: 0,
      reason: 'unsupported_scheme' as ExpansionFailureReason
    };
    if (!options.bypassCache) {
      await CACHE.set(cacheKey, result);
    }
    return result;
  }

  const visited = new Set<string>();
  const chain: string[] = [normalizeUrl(currentUrl)];
  let hops = 0;
  const start = Date.now();
  let reason: ExpansionFailureReason | undefined;

  while (hops < MAX_HOPS) {
    if (Date.now() - start > TOTAL_TIMEOUT_MS) {
      reason = 'timeout';
      break;
    }
    const normalized = normalizeUrl(currentUrl);
    if (visited.has(normalized)) {
      reason = 'redirect_loop';
      break;
    }
    visited.add(normalized);

    const requestInit: RequestInit = {
      method: 'HEAD',
      redirect: 'manual'
    };

    let response: Response;
    try {
      response = await fetchWithTimeout(currentUrl.toString(), requestInit, PER_HOP_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        reason = 'timeout';
      } else {
        reason = 'network_error';
      }
      break;
    }

    if (response.type === 'opaqueredirect') {
      // fall back to GET in case manual redirect is blocked
      try {
        response = await fetchWithTimeout(
          currentUrl.toString(),
          {
            method: 'GET',
            redirect: 'manual'
          },
          PER_HOP_TIMEOUT_MS
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          reason = 'timeout';
        } else {
          reason = 'network_error';
        }
        break;
      }
    }

    const location = response.headers.get('Location') || response.headers.get('location');
    if (!location || response.status < 300 || response.status >= 400) {
      break;
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      reason = 'network_error';
      break;
    }

    if (!['http:', 'https:'].includes(nextUrl.protocol)) {
      reason = 'unsupported_scheme';
      chain.push(normalizeUrl(nextUrl));
      currentUrl = nextUrl;
      break;
    }

    currentUrl = nextUrl;
    chain.push(normalizeUrl(currentUrl));
    hops += 1;
  }

  if (hops >= MAX_HOPS) {
    reason = 'too_many_redirects';
  }

  const finalUrl = normalizeUrl(currentUrl);
  const result: RedirectExpansion = {
    chain,
    finalUrl,
    hops: chain.length - 1,
    reason
  };

  if (!options.bypassCache) {
    await CACHE.set(cacheKey, result);
  }

  return result;
}
