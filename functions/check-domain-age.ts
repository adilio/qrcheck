import type { Handler } from '@netlify/functions';

const RDAP_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — registration dates don't move
const CACHE_MAX_ENTRIES = 500;

// Warm-instance cache: Netlify reuses function containers between
// invocations, so repeat lookups for popular domains skip RDAP entirely.
const cache = new Map<string, { result: DomainAgeResult; expires: number }>();

export interface DomainAgeResult {
  age_days: number | null;
  risk_points: number;
  message: string;
}

/**
 * Reduce a hostname to its registrable domain for RDAP lookup.
 * Rudimentary public-suffix approximation: keeps the last two labels, or the
 * last three when the second-level label is a common ccTLD prefix (co.uk etc).
 */
export function registrableDomain(host: string): string {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }
  const secondLevel = parts[parts.length - 2];
  const pseudoPublicSuffixes = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu']);
  if (pseudoPublicSuffixes.has(secondLevel)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function scoreAge(ageInDays: number): DomainAgeResult {
  if (ageInDays < 30) {
    return {
      age_days: ageInDays,
      risk_points: 20,
      message: `Very new domain (${ageInDays} days old)`
    };
  }
  if (ageInDays < 90) {
    return {
      age_days: ageInDays,
      risk_points: 10,
      message: `New domain (${ageInDays} days old)`
    };
  }
  if (ageInDays >= 5 * 365) {
    const years = Math.floor(ageInDays / 365);
    return {
      age_days: ageInDays,
      risk_points: -10,
      message: `Established domain (${years} years old)`
    };
  }
  return {
    age_days: ageInDays,
    risk_points: 0,
    message: `Domain ${ageInDays} days old`
  };
}

async function fetchRdapCreationDate(domain: string): Promise<string | null> {
  // rdap.org redirects to the authoritative RDAP server for the TLD
  const rdapUrl = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  const response = await fetch(rdapUrl, {
    headers: { Accept: 'application/rdap+json' },
    signal: AbortSignal.timeout(RDAP_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`RDAP lookup failed with status ${response.status}`);
  }

  const data = await response.json();

  // RDAP events array typically includes a registration/creation entry with eventDate
  const events: Array<{ eventAction?: unknown; eventDate?: unknown }> =
    Array.isArray(data.events) ? data.events : [];
  const creationEvent = events.find((event) =>
    typeof event?.eventAction === 'string' &&
    ['registration', 'creation', 'registered'].includes(event.eventAction.toLowerCase())
  );
  const createdDate = creationEvent?.eventDate || data?.registrationDate || data?.created;
  return typeof createdDate === 'string' ? createdDate : null;
}

/**
 * Look up a domain's registration age via RDAP and score it: newly-registered
 * domains raise risk, established (5y+) domains lower it. Never throws — an
 * unavailable or indeterminate lookup degrades to an age-unknown result with
 * zero risk points (the verdict must not hard-fail on a lookup error).
 */
export async function lookupDomainAge(host: string): Promise<DomainAgeResult> {
  const domain = registrableDomain(host);

  const cached = cache.get(domain);
  if (cached && cached.expires > Date.now()) {
    return cached.result;
  }

  let createdDate: string | null = null;
  try {
    createdDate = await fetchRdapCreationDate(domain);
  } catch {
    return {
      age_days: null,
      risk_points: 0,
      message: 'Domain age check failed'
    };
  }

  if (!createdDate || Number.isNaN(new Date(createdDate).getTime())) {
    return {
      age_days: null,
      risk_points: 0,
      message: 'Domain age could not be determined'
    };
  }

  const ageInDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24))
  );

  const result = scoreAge(ageInDays);

  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.clear();
  }
  cache.set(domain, { result, expires: Date.now() + CACHE_TTL_MS });

  return result;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { domain } = JSON.parse(event.body || '{}');

    if (!domain || typeof domain !== 'string' || domain.length > 253) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing domain' }) };
    }

    const result = await lookupDomainAge(domain);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' } as Record<string, string>,
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Domain age check failed:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        age_days: null,
        risk_points: 0,
        message: 'Domain age check failed'
      })
    };
  }
};
