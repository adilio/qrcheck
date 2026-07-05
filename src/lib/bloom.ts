/**
 * Client-side view of the URLHaus Bloom filter built at deploy time by
 * scripts/prebuild.mjs. Hashing/indexing comes from scripts/bloom.mjs so the
 * builder and this reader can never drift.
 *
 * False-positive rate is 1e-4 (documented in scripts/bloom.mjs): a rare
 * benign host can match, and the live URLHaus API lookup running alongside is
 * the authoritative confirmation. False negatives cannot occur.
 */

import { bloomHas } from '../../scripts/bloom.mjs';

export interface UrlhausBloomData {
  updatedAt: string;
  count: number;
  m: number;
  k: number;
  bits: string; // base64
}

export class UrlhausBloom {
  private bytes: Uint8Array;
  readonly count: number;
  readonly updatedAt: string;
  private m: number;
  private k: number;

  constructor(data: UrlhausBloomData) {
    this.m = data.m;
    this.k = data.k;
    this.count = data.count;
    this.updatedAt = data.updatedAt;

    const binary = atob(data.bits);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    this.bytes = bytes;
  }

  /** O(k) membership test. May rarely false-positive, never false-negative. */
  has(hostname: string): boolean {
    return bloomHas(hostname.toLowerCase(), this.m, this.k, this.bytes);
  }
}
