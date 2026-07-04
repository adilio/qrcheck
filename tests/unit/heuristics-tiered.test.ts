import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeHeuristicsTiered,
  analyzeTier1,
  applyDeltas,
  collectTier2Signals
} from '../../src/lib/heuristics-tiered';
import type { QRContent } from '../../src/lib/decode';

vi.mock('../../src/lib/api', () => ({
  checkAllThreatIntel: vi.fn()
}));

vi.mock('../../src/lib/urlhaus', () => ({
  loadUrlhausHosts: vi.fn()
}));

vi.mock('../../src/lib/shortener', () => ({
  checkUrlShortener: vi.fn()
}));

import { checkAllThreatIntel } from '../../src/lib/api';
import { loadUrlhausHosts } from '../../src/lib/urlhaus';
import { checkUrlShortener } from '../../src/lib/shortener';

const mockedIntel = vi.mocked(checkAllThreatIntel);
const mockedHosts = vi.mocked(loadUrlhausHosts);
const mockedShortener = vi.mocked(checkUrlShortener);

function urlContent(url: string): QRContent {
  return { type: 'url', text: url, raw: url };
}

function cleanIntel() {
  return {
    domainAge: { age_days: 3650, risk_points: 0, message: 'Domain 3650 days old' },
    threatIntel: {
      threat_detected: false,
      risk_points: 0,
      message: 'No threats detected',
      threats: [],
      sources_checked: ['Google Safe Browsing']
    }
  };
}

beforeEach(() => {
  mockedShortener.mockResolvedValue({ isShortener: false, domain: null, knownServices: [] });
  mockedHosts.mockResolvedValue({ updatedAt: '', count: 0, hosts: [] });
  mockedIntel.mockResolvedValue(cleanIntel());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function collectAll(content: QRContent, options = {}) {
  const results = [];
  for await (const r of analyzeHeuristicsTiered(content, options)) {
    results.push(r);
  }
  return results;
}

describe('analyzeTier1 with a resolved final URL', () => {
  it('scores the final destination, not the shortener', async () => {
    mockedShortener.mockResolvedValue({ isShortener: true, domain: 'bit.ly', knownServices: [] });

    const result = await analyzeTier1(urlContent('https://bit.ly/abc'), {
      finalUrl: 'http://192.0.2.7/index.html'
    });

    // IP-based signal comes from the FINAL url
    expect(result.details.domainReputation?.isIPBased).toBe(true);
    // shortener signal still reflects the ORIGINAL url
    expect(result.details.shortenerCheck?.isShortener).toBe(true);
    expect(mockedShortener).toHaveBeenCalledWith('https://bit.ly/abc');
  });

  it('behaves as before when no final URL is provided', async () => {
    const result = await analyzeTier1(urlContent('http://192.0.2.7/index.html'));
    expect(result.details.domainReputation?.isIPBased).toBe(true);
  });
});

describe('concurrent tier2/tier3 harness', () => {
  it('yields tier2 without waiting for a slow tier3', async () => {
    mockedHosts.mockResolvedValue({ updatedAt: '', count: 1, hosts: ['evil.example'] });

    let resolveIntel!: (v: ReturnType<typeof cleanIntel>) => void;
    mockedIntel.mockReturnValue(new Promise((resolve) => { resolveIntel = resolve; }));

    const gen = analyzeHeuristicsTiered(urlContent('https://evil.example/payload'));

    const first = (await gen.next()).value!;
    expect(first.tier1).toBeTruthy();
    expect(first.isComplete).toBe(false);

    const second = (await gen.next()).value!;
    expect(second.tier2).toBeTruthy();
    expect(second.tier3).toBeNull();
    expect(second.tier2!.details.threatIntel?.isMalicious).toBe(true);
    expect(second.verdict).toBe('danger');

    resolveIntel(cleanIntel());
    const third = (await gen.next()).value!;
    expect(third.tier3).toBeTruthy();
    expect(third.isComplete).toBe(true);

    expect((await gen.next()).done).toBe(true);
  });

  it('merges a tier3 that finishes before tier2', async () => {
    let resolveHosts!: (v: { updatedAt: string; count: number; hosts: string[] }) => void;
    mockedHosts.mockReturnValue(new Promise((resolve) => { resolveHosts = resolve; }));

    const gen = analyzeHeuristicsTiered(urlContent('https://example.com/'));
    await gen.next(); // tier1

    const second = (await gen.next()).value!;
    expect(second.tier3).toBeTruthy();
    expect(second.tier2).toBeNull();
    expect(second.tier3!.details.domainAge?.age_days).toBe(3650);

    resolveHosts({ updatedAt: '', count: 0, hosts: [] });
    const third = (await gen.next()).value!;
    expect(third.tier2).toBeTruthy();
    expect(third.isComplete).toBe(true);
  });

  it('flags a malicious host anywhere in the redirect chain', async () => {
    mockedHosts.mockResolvedValue({ updatedAt: '', count: 1, hosts: ['tracker.example'] });

    const results = await collectAll(urlContent('https://bit.ly/x'), {
      finalUrl: 'https://legit.example/landing',
      redirectChain: ['https://bit.ly/x', 'https://tracker.example/r', 'https://legit.example/landing']
    });

    const final = results[results.length - 1];
    expect(final.isComplete).toBe(true);
    expect(final.tier3!.details.threatIntel?.isMalicious).toBe(true);
  });

  it('degrades tier3 to "unknown" when the API fails, without rejecting', async () => {
    mockedIntel.mockRejectedValue(new Error('network down'));

    const results = await collectAll(urlContent('https://example.com/'));
    const final = results[results.length - 1];

    expect(final.isComplete).toBe(true);
    expect(final.tier3!.details.domainAge?.message).toBe('Unable to determine domain age');
    expect(final.tier3!.details.enhancedThreatIntel?.message).toBe('Unable to complete threat intelligence checks');
    expect(final.verdict).toBe('safe');
  });

  it('bounds a hung tier3 signal with the harness timeout', async () => {
    vi.useFakeTimers();
    mockedIntel.mockReturnValue(new Promise(() => { /* never resolves */ }));

    const gen = analyzeHeuristicsTiered(urlContent('https://example.com/'));
    await gen.next(); // tier1
    await gen.next(); // tier2 (fast)

    const pendingTier3 = gen.next();
    await vi.advanceTimersByTimeAsync(10_000);
    const third = (await pendingTier3).value!;

    expect(third.isComplete).toBe(true);
    expect(third.tier3!.details.domainAge?.message).toBe('Unable to determine domain age');
  });

  it('adds domain-age risk points from tier3 to the score', async () => {
    mockedIntel.mockResolvedValue({
      domainAge: { age_days: 5, risk_points: 20, message: 'Very new domain (5 days old)' },
      threatIntel: cleanIntel().threatIntel
    });

    const results = await collectAll(urlContent('https://example.com/'));
    const final = results[results.length - 1];

    expect(final.tier3!.score).toBe(20);
    expect(final.tier3!.details.domainReputation?.isNewDomain).toBe(true);
  });
});

describe('applyDeltas', () => {
  const base = { risk: 'low' as const, score: 10, details: {}, recommendations: [] };

  it('clamps the score to a 0 floor (negative deltas from established domains)', () => {
    const merged = applyDeltas(base, [{ scoreDelta: -30, details: {}, recommendations: [] }]);
    expect(merged.score).toBe(0);
    expect(merged.risk).toBe('low');
  });

  it('clamps the score to a 100 ceiling', () => {
    const merged = applyDeltas(base, [{ scoreDelta: 500, details: {}, recommendations: [] }]);
    expect(merged.score).toBe(100);
    expect(merged.risk).toBe('high');
  });

  it('ignores null deltas', () => {
    const merged = applyDeltas(base, [null, null]);
    expect(merged.score).toBe(10);
  });
});

describe('collectTier2Signals', () => {
  it('returns an empty delta when the host DB cannot load', async () => {
    mockedHosts.mockRejectedValue(new Error('offline'));
    const delta = await collectTier2Signals(['https://example.com/']);
    expect(delta.scoreDelta).toBe(0);
  });
});

describe('non-URL content', () => {
  it('completes immediately without network tiers', async () => {
    const results = await collectAll({ type: 'text', text: 'hello', raw: 'hello' });
    expect(results).toHaveLength(2);
    expect(results[1].isComplete).toBe(true);
    expect(mockedIntel).not.toHaveBeenCalled();
    expect(mockedHosts).not.toHaveBeenCalled();
  });
});
