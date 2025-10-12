import { KNOWN_SHORTENER_DOMAINS } from '../data/shorteners';
import { isSuspiciousTld } from '../data/tlds_suspicious';
import { SUSPICIOUS_KEYWORDS } from '../data/keywords';
import type { UrlAnalysisOptions, UrlAnalysisResult, Verdict } from '../types';
import { expandUrl } from './expand';
import { getDomainAge } from './domainAge';

const EXECUTABLE_EXTENSIONS = ['.exe', '.msi', '.scr', '.bat', '.cmd', '.ps1', '.apk', '.dmg', '.pkg'];
const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z'];
const ARCHIVE_ALERT_QUERY = ['update', 'payload'];

function normalizeHost(host: string): string {
  return host.toLowerCase();
}

function matchesKnownShortener(host: string): boolean {
  const normalized = normalizeHost(host);
  return KNOWN_SHORTENER_DOMAINS.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function isLikelyUnknownShortener(url: URL): boolean {
  if (matchesKnownShortener(url.hostname)) return false;
  const host = normalizeHost(url.hostname);
  if (host.length > 18) return false;
  const path = url.pathname.replace(/^\/+/, '');
  if (!path) return false;
  if (path.includes('/')) return false;
  if (path.length > 15) return false;
  return /^[A-Za-z0-9_-]+$/.test(path);
}

function tldFromHost(host: string): string | null {
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  return `.${parts[parts.length - 1].toLowerCase()}`;
}

function hasSuspiciousTld(host: string): string | null {
  const tld = tldFromHost(host);
  if (!tld) return null;
  return isSuspiciousTld(tld) ? tld : null;
}

function hasPunycode(host: string): boolean {
  return host.split('.').some((segment) => segment.startsWith('xn--'));
}

function extractExtension(pathname: string): string | null {
  const last = pathname.split('/').pop();
  if (!last) return null;
  const index = last.lastIndexOf('.');
  if (index === -1) return null;
  return last.slice(index).toLowerCase();
}

function countQueryParams(url: URL): number {
  let count = 0;
  url.searchParams.forEach(() => {
    count += 1;
  });
  return count;
}

function findKeywords(url: URL): string[] {
  const target = `${url.pathname} ${url.search}`.toLowerCase();
  const matches = new Set<string>();
  for (const keyword of SUSPICIOUS_KEYWORDS) {
    if (target.includes(keyword)) {
      matches.add(keyword);
    }
  }
  return Array.from(matches);
}

function redactSearch(url: URL): string {
  if (!url.search) return url.toString();
  const clone = new URL(url.toString());
  clone.searchParams.forEach((value, key) => {
    if (/token|key|pass|secret|code|credential/i.test(key)) {
      clone.searchParams.set(key, '•••');
    } else if (value.length > 32) {
      clone.searchParams.set(key, `${value.slice(0, 4)}…`);
    }
  });
  return clone.toString();
}

function computeVerdict(score: number): Verdict {
  if (score >= 70) return 'block';
  if (score >= 40) return 'warn';
  return 'safe';
}

function summariseReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons));
}

export interface AnalyzeUrlOptions extends UrlAnalysisOptions {
  skipExpansion?: boolean;
}

export async function analyzeUrl(originalUrl: string, options: AnalyzeUrlOptions = {}): Promise<UrlAnalysisResult> {
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return {
      original_url: originalUrl,
      redirect_chain: [originalUrl],
      final_url: originalUrl,
      signals: {
        is_https: false,
        suspicious_tld: false,
        punycode: false,
        executable_mime: false,
        very_long: originalUrl.length > 2048,
        shortener: 'none',
        redirect_hops: 0,
        domain_age_days: null,
        suspicious_keywords: [],
        dangerous_scheme: true,
        archive_download: false
      },
      score: 50,
      verdict: 'warn',
      reasons: ['URL could not be parsed'],
      warnings: ['Input is not a valid URL']
    };
  }

  const scheme = parsed.protocol;
  const isDangerousScheme = scheme === 'data:' || scheme === 'file:';
  const reasons: string[] = [];
  const warnings: string[] = [];

  const expansion = options.skipExpansion
    ? { chain: [parsed.toString()], finalUrl: parsed.toString(), hops: 0, reason: undefined }
    : await expandUrl(parsed.toString(), { bypassCache: options.bypassCache });

  const finalUrl = new URL(expansion.finalUrl || parsed.toString());
  const finalDisplayUrl = redactSearch(finalUrl);
  const chainDisplay = expansion.chain.map((hop) => {
    try {
      return redactSearch(new URL(hop));
    } catch {
      return hop;
    }
  });

  const reasonsScore = {
    https: 20,
    tld: 25,
    punycode: 20,
    executable: 30,
    long: 10,
    shortenerUnknown: 25,
    shortenerPenalty: 10,
    keywords: 30,
    dangerousScheme: 50,
    domainAge: 30,
    redirects: 15,
    displayMismatch: 20,
    archiveBase: 15,
    archiveQuery: 25
  } as const;

  let score = 0;

  const isHttps = finalUrl.protocol === 'https:';
  if (!isHttps && !isDangerousScheme) {
    score += reasonsScore.https;
    reasons.push('Not using HTTPS');
  }

  const tld = hasSuspiciousTld(finalUrl.hostname);
  if (tld) {
    score += reasonsScore.tld;
    reasons.push(`Suspicious TLD ${tld}`);
  }

  const punycode = hasPunycode(finalUrl.hostname);
  if (punycode) {
    score += reasonsScore.punycode;
    reasons.push('Punycode/IDN domain');
  }

  const extension = extractExtension(finalUrl.pathname);
  const isExecutable = extension ? EXECUTABLE_EXTENSIONS.includes(extension) : false;
  if (isExecutable) {
    score += reasonsScore.executable;
    reasons.push(`Executable download (${extension})`);
  }

  const isArchive = extension ? ARCHIVE_EXTENSIONS.includes(extension) : false;
  if (isArchive) {
    score += reasonsScore.archiveBase;
    reasons.push(`Archive download (${extension})`);
    const queryText = finalUrl.search.toLowerCase();
    if (ARCHIVE_ALERT_QUERY.some((keyword) => queryText.includes(keyword))) {
      score += reasonsScore.archiveQuery;
      reasons.push('Archive link references update/payload');
    }
  }

  const veryLong = finalUrl.toString().length > 2048 || countQueryParams(finalUrl) > 15;
  if (veryLong) {
    score += reasonsScore.long;
    reasons.push('Very long URL');
  }

  const keywords = findKeywords(finalUrl);
  if (keywords.length) {
    score += reasonsScore.keywords;
    reasons.push(`Suspicious keywords (${keywords.join(', ')})`);
  }

  let shortenerState: 'known' | 'unknown' | 'none' = 'none';
  const host = parsed.hostname;
  const isKnownShortener = matchesKnownShortener(host);
  const likelyUnknownShortener = isLikelyUnknownShortener(parsed);

  if (isKnownShortener) {
    shortenerState = 'known';
  } else if (likelyUnknownShortener) {
    shortenerState = 'unknown';
    if (expansion.reason) {
      score += reasonsScore.shortenerUnknown;
      reasons.push('Unknown shortener could not be expanded');
    } else {
      score += reasonsScore.shortenerPenalty;
      reasons.push('Unknown shortener expanded');
    }
  }

  if (isDangerousScheme) {
    score += reasonsScore.dangerousScheme;
    reasons.push(`${scheme.replace(':', '')} scheme is high risk`);
  }

  const redirectHops = expansion.hops;
  if (redirectHops >= 3) {
    score += reasonsScore.redirects;
    reasons.push(`Multiple redirects (${redirectHops})`);
  }

  const domainAge = await getDomainAge(finalUrl.hostname, { bypassCache: options.bypassCache });
  if (domainAge.status === 'ok' && domainAge.days !== null && domainAge.days < 30) {
    score += reasonsScore.domainAge;
    reasons.push(`Final domain age ${domainAge.days} days`);
  }

  if (options.labelHost) {
    const displayHost = options.labelHost.toLowerCase();
    const finalHost = finalUrl.hostname.toLowerCase();
    if (displayHost && finalHost && displayHost !== finalHost && !finalHost.endsWith(`.${displayHost}`)) {
      score += reasonsScore.displayMismatch;
      reasons.push('Display domain mismatch');
    }
  }

  if (expansion.reason) {
    warnings.push(`Expansion incomplete (${expansion.reason})`);
  }

  const verdict = computeVerdict(score);

  return {
    original_url: originalUrl,
    redirect_chain: chainDisplay,
    final_url: finalDisplayUrl,
    signals: {
      is_https: isHttps,
      suspicious_tld: Boolean(tld),
      punycode,
      executable_mime: isExecutable,
      very_long: veryLong,
      shortener: shortenerState,
      redirect_hops: redirectHops,
      domain_age_days: domainAge.status === 'ok' ? domainAge.days : null,
      suspicious_keywords: keywords,
      dangerous_scheme: isDangerousScheme,
      archive_download: isArchive
    },
    score,
    verdict,
    reasons: summariseReasons(reasons),
    warnings,
    display_label_mismatch: reasons.includes('Display domain mismatch') || undefined,
    expansion_failure: expansion.reason
  };
}
