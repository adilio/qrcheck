/**
 * Tiered Heuristics Analysis
 *
 * Progressive analysis in 3 tiers:
 *
 * - Tier 1 (Instant, <50ms): pure client-side, synchronous checks
 * - Tier 2 (Fast): local URLHaus cache lookup
 * - Tier 3 (Async): server-side API calls (domain age, threat intel)
 *
 * Tier 2 and Tier 3 run CONCURRENTLY inside a bounded harness: every network
 * signal has its own timeout, results merge into the verdict as they arrive
 * (in completion order), and a hung or failed signal degrades to "unknown"
 * without ever blocking the verdict. Worst-case latency is the slowest single
 * signal's timeout, not the sum of all signals.
 *
 * When a redirect chain has been resolved (see functions/resolve.ts), pass the
 * final destination via `AnalysisOptions.finalUrl` — URL heuristics then score
 * the real endpoint while the shortener signal still reflects the original URL.
 */

import type { QRContent } from './decode';
import type { HeuristicResult } from './heuristics';
import { checkUrlShortener } from './shortener';
import { isSuspiciousTld } from '../data/tlds_suspicious';
import { SUSPICIOUS_KEYWORDS } from '../data/keywords';

export interface TieredHeuristicResult {
  tier1: HeuristicResult | null;
  tier2: HeuristicResult | null;
  tier3: HeuristicResult | null;
  verdict: 'safe' | 'caution' | 'danger' | 'analyzing';
  isComplete: boolean;
}

export interface AnalysisOptions {
  /** Resolved final destination (after redirect expansion). Defaults to the raw URL. */
  finalUrl?: string;
  /** Ordered redirect chain including the original and final URL. */
  redirectChain?: string[];
}

/**
 * A signal group's contribution to the verdict. Tiers produce deltas that are
 * merged into the cumulative result in whatever order they complete.
 */
export interface SignalDelta {
  scoreDelta: number;
  details: HeuristicResult['details'];
  recommendations: string[];
}

const TIER2_TIMEOUT_MS = 4_000;
const TIER3_TIMEOUT_MS = 10_000;

function emptyDelta(): SignalDelta {
  return { scoreDelta: 0, details: {}, recommendations: [] };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function riskFor(score: number): HeuristicResult['risk'] {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Tier 1: Instant client-side checks (<50ms)
 *
 * Structure/keyword/domain checks run against the resolved final URL when one
 * is provided; the shortener check always runs against the original URL, since
 * that signal is about how the link was presented, not where it lands.
 */
export async function analyzeTier1(content: QRContent, options: AnalysisOptions = {}): Promise<HeuristicResult> {
  const result: HeuristicResult = {
    risk: 'low',
    score: 0,
    details: {},
    recommendations: []
  };

  if (content.type !== 'url') {
    result.recommendations.push('Only URLs can be analyzed for heuristics');
    return result;
  }

  const originalUrl = content.text;
  const url = options.finalUrl || originalUrl;
  const recommendationSet = new Set<string>();
  const addRecommendation = (message: string) => {
    if (message) recommendationSet.add(message);
  };

  // URL shortener check (on the original URL — the final URL is post-expansion)
  try {
    result.details.shortenerCheck = await checkUrlShortener(originalUrl);

    if (result.details.shortenerCheck.isShortener) {
      const domain = result.details.shortenerCheck.domain?.toLowerCase() || '';
      let shortenerScore = 45;

      const reputableShorteners = [
        'bit.ly', 'bitly.com', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly',
        'buff.ly', 'short.link', 'lnkd.in', 'fb.me', 'youtu.be', 'twitter.com',
        'x.com', 'instagram.com', 'tiktok.com', 'qrco.de'
      ];

      const mediumRiskShorteners = [
        'cutt.ly', 'tiny.cc', 'is.gd', 'v.gd', 'bc.vc', 'adf.ly'
      ];

      if (reputableShorteners.includes(domain)) {
        shortenerScore = 30;
        addRecommendation('This URL uses a reputable shortening service. Verify the destination before visiting.');
      } else if (mediumRiskShorteners.includes(domain)) {
        shortenerScore = 35;
        addRecommendation('This URL uses a less common shortening service. Exercise caution.');
      } else {
        addRecommendation('This URL uses an unknown or high-risk shortening service. Proceed with extreme caution.');
      }

      result.score += shortenerScore;
    }
  } catch (_e) {
    // Shortener check failed, continue
  }

  // URL length check
  const URL_LENGTH_THRESHOLD = 2000;
  if (url.length > URL_LENGTH_THRESHOLD) {
    result.details.urlLength = {
      value: url.length,
      threshold: URL_LENGTH_THRESHOLD,
      isExcessive: true
    };
    result.score += 20;
    addRecommendation('URL is excessively long, which is often used in phishing attacks.');
  }

  // Obfuscation patterns check
  const obfuscationPatterns: string[] = [];

  if (url.match(/%[0-9A-Fa-f]{2}/)) obfuscationPatterns.push('URL-encoded characters');
  if (url.match(/\\x[0-9A-Fa-f]{2}/)) obfuscationPatterns.push('Hex-encoded characters');
  if (url.match(/&#\d+;/)) obfuscationPatterns.push('HTML entities');
  if (url.match(/%25[0-9A-Fa-f]{2}/)) obfuscationPatterns.push('Double URL encoding');

  if (obfuscationPatterns.length > 0) {
    result.details.obfuscation = {
      hasObfuscation: true,
      patterns: obfuscationPatterns
    };
    result.score += 40;
    addRecommendation(`URL contains obfuscation: ${obfuscationPatterns.join(', ')}`);
  }

  // Suspicious keywords check
  const matches: string[] = [];
  const urlLower = url.toLowerCase();

  for (const keyword of SUSPICIOUS_KEYWORDS) {
    if (urlLower.includes(keyword.toLowerCase())) {
      matches.push(keyword);
    }
  }

  if (matches.length > 0) {
    result.details.suspiciousKeywords = {
      hasKeywords: true,
      matches
    };
    result.score += 40;
    addRecommendation(`Contains suspicious keywords: ${matches.join(', ')}`);
  }

  // Domain reputation check
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    const isIPBased = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(domain) ||
                      /^\[[0-9a-fA-F:]+\]$/.test(domain);

    const hasSuspiciousTLD = isSuspiciousTld(domain);

    result.details.domainReputation = {
      isNewDomain: false, // Will be determined in Tier 3
      hasSuspiciousTLD,
      isIPBased
    };

    if (isIPBased) {
      result.score += 35;
      addRecommendation('URL uses an IP address instead of a domain name, which is suspicious.');
    }

    if (hasSuspiciousTLD) {
      result.score += 25;
      addRecommendation('URL uses a suspicious top-level domain (TLD).');
    }
  } catch (_e) {
    // Domain parsing failed
  }

  // Typosquatting detection
  const POPULAR_BRANDS = ['google', 'paypal', 'amazon', 'facebook', 'microsoft', 'apple', 'netflix'];

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/^www\./, '').split('.')[0].toLowerCase();

    for (const brand of POPULAR_BRANDS) {
      if (domain === brand) continue; // Exact match is fine

      const distance = levenshteinDistance(domain, brand);
      if (distance === 1 || distance === 2) {
        result.details.typosquatting = {
          isTyposquat: true,
          detectedBrand: brand,
          distance
        };
        result.score += 40;
        addRecommendation(`Domain appears to be typosquatting "${brand}" (similarity detected).`);
        break;
      }
    }
  } catch (_e) {
    // Typosquatting check failed
  }

  // Homograph attack detection
  const cyrillicChars = [
    { fake: 'а', real: 'a' }, { fake: 'е', real: 'e' }, { fake: 'о', real: 'o' },
    { fake: 'р', real: 'p' }, { fake: 'с', real: 'c' }, { fake: 'у', real: 'y' },
    { fake: 'х', real: 'x' }
  ];

  const detectedHomographs: Array<{fake: string, real: string}> = [];

  for (const { fake, real } of cyrillicChars) {
    if (url.includes(fake)) {
      detectedHomographs.push({ fake, real });
    }
  }

  if (detectedHomographs.length > 0) {
    result.details.homographs = {
      hasHomographs: true,
      characters: detectedHomographs
    };
    result.score += 50;
    addRecommendation('URL contains look-alike characters (homograph attack detected).');
  }

  // Enhanced keywords check
  const keywordCategories = {
    urgent: ['urgent', 'act-now', 'limited-time', 'expires'],
    account: ['account', 'suspended', 'verify', 'confirm'],
    reward: ['winner', 'prize', 'reward', 'claim'],
    financial: ['bank', 'payment', 'invoice', 'refund'],
    social: ['message', 'friend-request', 'notification'],
    threat: ['warning', 'security-alert', 'locked'],
    download: ['download', 'install', 'update-required']
  };

  const enhancedMatches: Array<{category: string, word: string}> = [];

  for (const [category, words] of Object.entries(keywordCategories)) {
    for (const word of words) {
      if (urlLower.includes(word.toLowerCase())) {
        enhancedMatches.push({ category, word });
      }
    }
  }

  if (enhancedMatches.length > 0) {
    result.details.enhancedKeywords = {
      hasKeywords: true,
      matches: enhancedMatches
    };
    result.score += Math.min(enhancedMatches.length * 10, 40);
    addRecommendation(`Contains suspicious words: ${enhancedMatches.map(m => m.word).join(', ')}`);
  }

  result.risk = riskFor(result.score);
  result.recommendations = Array.from(recommendationSet);
  return result;
}

/**
 * Tier 2: local URLHaus cache lookup.
 *
 * Checks every hostname in play (original URL, redirect hops, final URL) so a
 * malicious host anywhere in the chain is caught. Never throws; a failed or
 * slow lookup degrades to an empty contribution.
 */
export async function collectTier2Signals(urls: string[]): Promise<SignalDelta> {
  const delta = emptyDelta();

  try {
    const { loadUrlhausHosts } = await import('./urlhaus');
    const hosts = await withTimeout(loadUrlhausHosts(), TIER2_TIMEOUT_MS, null);
    if (!hosts) {
      return delta;
    }

    const hostSet = new Set(hosts.hosts);
    const hostnames = new Set(urls.map(hostnameOf).filter((h): h is string => Boolean(h)));
    const matched = Array.from(hostnames).filter((h) => hostSet.has(h));

    if (matched.length > 0) {
      delta.details.threatIntel = {
        urlhausMatches: matched.length,
        isMalicious: true
      };
      delta.scoreDelta += 80;
      delta.recommendations.push('This URL is listed in the URLHaus malware database.');
    }
  } catch (_e) {
    // URLHaus cache check failed; the live Tier 3 lookup still runs
  }

  return delta;
}

/**
 * Tier 3: server-side API calls (domain age, Google Safe Browsing, AbuseIPDB).
 *
 * The underlying fetches carry their own AbortController timeouts (see api.ts)
 * and this whole group is additionally bounded by TIER3_TIMEOUT_MS. Failures
 * surface as "unable to determine" details so the UI shows the checks as
 * completed-but-unknown rather than hanging.
 */
export async function collectTier3Signals(url: string): Promise<SignalDelta> {
  const delta = emptyDelta();

  const unavailable = () => {
    delta.details.domainAge = {
      age_days: null,
      risk_points: 0,
      message: 'Unable to determine domain age'
    };
    delta.details.enhancedThreatIntel = {
      threat_detected: false,
      risk_points: 0,
      message: 'Unable to complete threat intelligence checks',
      threats: [],
      sources_checked: []
    };
  };

  try {
    const { checkAllThreatIntel } = await import('./api');
    const intelResults = await withTimeout(checkAllThreatIntel(url), TIER3_TIMEOUT_MS, null);

    if (!intelResults) {
      unavailable();
      return delta;
    }

    if (intelResults.domainAge) {
      delta.details.domainAge = intelResults.domainAge;
      if (intelResults.domainAge.risk_points !== 0) {
        delta.scoreDelta += intelResults.domainAge.risk_points;
        if (intelResults.domainAge.risk_points > 0) {
          delta.recommendations.push(`Domain age: ${intelResults.domainAge.message}`);
        }
      }
    } else {
      delta.details.domainAge = {
        age_days: null,
        risk_points: 0,
        message: 'Unable to determine domain age'
      };
    }

    if (intelResults.threatIntel) {
      delta.details.enhancedThreatIntel = intelResults.threatIntel;
      if (intelResults.threatIntel.threat_detected) {
        delta.scoreDelta += intelResults.threatIntel.risk_points;
        delta.recommendations.push('Threat intelligence providers flagged this URL as malicious.');
      }
    } else {
      delta.details.enhancedThreatIntel = {
        threat_detected: false,
        risk_points: 0,
        message: 'No threats detected',
        threats: [],
        sources_checked: []
      };
    }
  } catch (_e) {
    unavailable();
  }

  return delta;
}

/**
 * Merge tier deltas onto the tier-1 base, recomputing score and risk.
 * The score is clamped to 0..100 (established-domain signals may be negative).
 */
export function applyDeltas(base: HeuristicResult, deltas: Array<SignalDelta | null>): HeuristicResult {
  const result: HeuristicResult = {
    risk: base.risk,
    score: base.score,
    details: { ...base.details },
    recommendations: [...base.recommendations]
  };

  for (const delta of deltas) {
    if (!delta) continue;
    result.score += delta.scoreDelta;
    Object.assign(result.details, delta.details);
    result.recommendations.push(...delta.recommendations);
  }

  result.score = Math.max(0, Math.min(100, result.score));

  const age = result.details.domainAge;
  if (age && result.details.domainReputation) {
    result.details.domainReputation = {
      ...result.details.domainReputation,
      isNewDomain: age.age_days !== null && age.age_days < 30
    };
  }

  result.risk = riskFor(result.score);
  return result;
}

/**
 * Progressive heuristics analyzer — yields results as each tier completes.
 *
 * Tier 1 yields immediately; Tiers 2 and 3 are started together and merged in
 * completion order, so a slow Tier 3 never delays the Tier 2 result (or vice
 * versa).
 */
export async function* analyzeHeuristicsTiered(
  content: QRContent,
  options: AnalysisOptions = {}
): AsyncGenerator<TieredHeuristicResult, void, undefined> {
  const tier1 = await analyzeTier1(content, options);
  yield {
    tier1,
    tier2: null,
    tier3: null,
    verdict: verdictFor(tier1),
    isComplete: false
  };

  if (content.type !== 'url') {
    // Non-URL payloads have no network tiers; finalize immediately.
    yield {
      tier1,
      tier2: tier1,
      tier3: tier1,
      verdict: verdictFor(tier1),
      isComplete: true
    };
    return;
  }

  const effectiveUrl = options.finalUrl || content.text;
  const urlsInPlay = Array.from(new Set([content.text, effectiveUrl, ...(options.redirectChain ?? [])]));

  // Start both tiers at once — the concurrency harness. Each resolves to its
  // delta (never rejects), tagged so results merge in completion order.
  const pending = new Map<2 | 3, Promise<{ tier: 2 | 3; delta: SignalDelta }>>([
    [2, collectTier2Signals(urlsInPlay).then((delta) => ({ tier: 2 as const, delta }))],
    [3, collectTier3Signals(effectiveUrl).then((delta) => ({ tier: 3 as const, delta }))]
  ]);

  let tier2Delta: SignalDelta | null = null;
  let tier3Delta: SignalDelta | null = null;

  while (pending.size > 0) {
    const settled = await Promise.race(pending.values());
    pending.delete(settled.tier);
    if (settled.tier === 2) {
      tier2Delta = settled.delta;
    } else {
      tier3Delta = settled.delta;
    }

    const cumulative = applyDeltas(tier1, [tier2Delta, tier3Delta]);
    yield {
      tier1,
      tier2: tier2Delta ? applyDeltas(tier1, [tier2Delta]) : null,
      tier3: tier3Delta ? cumulative : null,
      verdict: verdictFor(cumulative),
      isComplete: pending.size === 0
    };
  }
}

function verdictFor(result: HeuristicResult | null): 'safe' | 'caution' | 'danger' | 'analyzing' {
  if (!result) return 'analyzing';
  if (result.risk === 'high') return 'danger';
  if (result.risk === 'medium') return 'caution';
  return 'safe';
}

/**
 * Levenshtein distance algorithm for typosquatting detection
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
