/**
 * Bloom filter for the URLHaus host set — shared between the build script
 * (scripts/prebuild.mjs, which constructs the filter) and the client
 * (src/lib/bloom.ts, which queries it). Both sides import THIS module for
 * hashing/indexing so the implementations can never drift.
 *
 * Parameters: sized for a 0.01% (1e-4) false-positive rate — roughly 1 benign
 * host in 10,000 would wrongly match; the live URLHaus API lookup that runs
 * alongside acts as the authoritative check. ~19.2 bits/element: 13k hosts
 * fit in ~31 KB of bits (~42 KB base64) versus 352 KB of raw JSON hostnames.
 */

export const DEFAULT_FALSE_POSITIVE_RATE = 1e-4;

/** 32-bit FNV-1a with a configurable seed (used twice for double hashing). */
export function fnv1a(str, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * murmur3 fmix32 finalizer. FNV-1a alone has weak avalanche, which correlates
 * h1/h2 on similar hostnames and measurably inflates the false-positive rate;
 * this mixing step restores it.
 */
function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The k bit indices for a value via double hashing:
 * index_i = (h1 + i * h2) mod m. Safe in double precision: h1,h2 < 2^32 and
 * i is small, so h1 + i*h2 < 2^53.
 */
export function bloomIndices(value, m, k) {
  const h1 = fmix32(fnv1a(value, 0x811c9dc5));
  const h2 = (fmix32(fnv1a(value, 0x9747b28c)) % m) || 1;
  const indices = new Array(k);
  for (let i = 0; i < k; i++) {
    indices[i] = (h1 + i * h2) % m;
  }
  return indices;
}

/** Build a filter over `items`, returning { m, k, bytes: Uint8Array }. */
export function buildBloomFilter(items, falsePositiveRate = DEFAULT_FALSE_POSITIVE_RATE) {
  const n = Math.max(items.length, 1);
  const m = Math.max(8, Math.ceil((-n * Math.log(falsePositiveRate)) / (Math.LN2 * Math.LN2)));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  const bytes = new Uint8Array(Math.ceil(m / 8));

  for (const item of items) {
    for (const index of bloomIndices(item, m, k)) {
      bytes[index >> 3] |= 1 << (index & 7);
    }
  }

  return { m, k, bytes };
}

/** Membership test against raw filter bytes. */
export function bloomHas(value, m, k, bytes) {
  for (const index of bloomIndices(value, m, k)) {
    if ((bytes[index >> 3] & (1 << (index & 7))) === 0) {
      return false;
    }
  }
  return true;
}
