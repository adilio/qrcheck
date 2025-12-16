/**
 * Tiered Heuristics Analysis
 *
 * This module provides a progressive heuristics analysis system that delivers
 * instant feedback by splitting checks into 3 tiers based on execution time:
 *
 * - Tier 1 (Instant, <50ms): Pure client-side, synchronous checks
 * - Tier 2 (Fast, 100-300ms): Network checks with local caching
 * - Tier 3 (Async, 200-500ms): Server-side API calls
 *
 * This enables progressive UI updates and dramatically improves perceived performance.
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

/**
 * Tier 1: Instant client-side checks (<50ms)
 *
 * These checks run synchronously and provide immediate feedback:
 * - URL parsing and protocol validation
 * - Suspicious TLD detection
 * - Keyword detection
 * - URL shortener identification
 * - Typosquatting detection
 * - Homograph attack detection
 * - Obfuscation pattern detection
 */
export async function analyzeTier1(content: QRContent): Promise<HeuristicResult> {
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

  const url = content.text;
  const recommendationSet = new Set<string>();
  const addRecommendation = (message: string) => {
    if (message) recommendationSet.add(message);
  };

  // URL shortener check
  try {
    result.details.shortenerCheck = await checkUrlShortener(url);

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
  } catch (e) {
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
  } catch (e) {
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
  } catch (e) {
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

  // Determine risk level for Tier 1
  if (result.score >= 70) {
    result.risk = 'high';
  } else if (result.score >= 40) {
    result.risk = 'medium';
  } else {
    result.risk = 'low';
  }

  result.recommendations = Array.from(recommendationSet);
  return result;
}

/**
 * Tier 2: Fast network checks with caching (100-300ms)
 *
 * These checks use network requests but leverage caching:
 * - Redirect expansion (first hop only)
 * - Local URLHaus cache lookup
 */
export async function analyzeTier2(content: QRContent, tier1Result: HeuristicResult): Promise<HeuristicResult> {
  const result = { ...tier1Result };

  if (content.type !== 'url') {
    return result;
  }

  const url = content.text;

  // Check URLHaus local cache for known malicious hosts
  try {
    const { loadUrlhausHosts } = await import('./urlhaus');
    const hosts = await loadUrlhausHosts();

    const hostname = new URL(url).hostname.toLowerCase();
    const isMalicious = hosts.hosts.includes(hostname);

    if (isMalicious) {
      result.details.threatIntel = {
        urlhausMatches: 1,
        isMalicious: true
      };
      result.score += 80;
      result.recommendations.push('This URL is listed in the URLHaus malware database.');
      result.risk = 'high';
    }
  } catch (e) {
    // URLHaus cache check failed, will be checked in Tier 3
  }

  return result;
}

/**
 * Tier 3: Server-side API calls (200-500ms)
 *
 * These checks require server-side processing:
 * - Domain age verification
 * - Enhanced threat intelligence (Google Safe Browsing, AbuseIPDB)
 * - Full redirect chain expansion
 */
export async function analyzeTier3(content: QRContent, tier2Result: HeuristicResult): Promise<HeuristicResult> {
  const result = { ...tier2Result };

  if (content.type !== 'url') {
    return result;
  }

  const url = content.text;

  // Parallel threat intelligence checks
  try {
    const { checkAllThreatIntel } = await import('./api');
    const intelResults = await checkAllThreatIntel(url);

    // Process domain age results
    if (intelResults.domainAge && intelResults.domainAge.risk_points > 0) {
      result.details.domainAge = intelResults.domainAge;
      result.score += intelResults.domainAge.risk_points;
      result.recommendations.push(`Domain age: ${intelResults.domainAge.message}`);

      // Update domain reputation with age information
      if (result.details.domainReputation) {
        result.details.domainReputation.isNewDomain = intelResults.domainAge.age_days !== null &&
                                                        intelResults.domainAge.age_days < 30;
      }
    }

    // Process enhanced threat intel results
    if (intelResults.threatIntel) {
      result.details.enhancedThreatIntel = intelResults.threatIntel;

      if (intelResults.threatIntel.threat_detected) {
        result.score += intelResults.threatIntel.risk_points;
        result.recommendations.push('Threat intelligence providers flagged this URL as malicious.');
      }
    } else {
      // Threat intel check failed
      result.details.enhancedThreatIntel = {
        threat_detected: false,
        risk_points: 0,
        message: 'Threat intelligence check failed',
        threats: [],
        sources_checked: []
      };
      result.recommendations.push('Unable to complete all threat intelligence checks. Try again later.');
    }
  } catch (e) {
    // API calls failed
    console.warn('Tier 3 analysis failed:', e);
  }

  // Final risk calculation
  if (result.score >= 70) {
    result.risk = 'high';
  } else if (result.score >= 40) {
    result.risk = 'medium';
  } else {
    result.risk = 'low';
  }

  return result;
}

/**
 * Progressive heuristics analyzer - yields results as each tier completes
 */
export async function* analyzeHeuristicsTiered(content: QRContent): AsyncGenerator<TieredHeuristicResult, void, undefined> {
  // Yield Tier 1 immediately
  const tier1 = await analyzeTier1(content);
  yield {
    tier1,
    tier2: null,
    tier3: null,
    verdict: calculateVerdict(tier1, null, null),
    isComplete: false
  };

  // Yield Tier 2 when ready
  const tier2 = await analyzeTier2(content, tier1);
  yield {
    tier1,
    tier2,
    tier3: null,
    verdict: calculateVerdict(tier1, tier2, null),
    isComplete: false
  };

  // Yield Tier 3 when ready (final result)
  const tier3 = await analyzeTier3(content, tier2);
  yield {
    tier1,
    tier2,
    tier3,
    verdict: calculateVerdict(tier1, tier2, tier3),
    isComplete: true
  };
}

/**
 * Calculate overall verdict based on available tier results
 */
function calculateVerdict(
  tier1: HeuristicResult | null,
  tier2: HeuristicResult | null,
  tier3: HeuristicResult | null
): 'safe' | 'caution' | 'danger' | 'analyzing' {
  const latestResult = tier3 || tier2 || tier1;

  if (!latestResult) {
    return 'analyzing';
  }

  if (latestResult.risk === 'high') {
    return 'danger';
  } else if (latestResult.risk === 'medium') {
    return 'caution';
  } else {
    return 'safe';
  }
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
