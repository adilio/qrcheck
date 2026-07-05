import type { Handler } from "@netlify/functions";

const UA = "QRCheck-LinkResolver/1.0 (+https://qrcheck.ca)";
const MAX_HOPS = 10;
const TIMEOUT_MS = 5000;
const OVERALL_DEADLINE_MS = 10000;

// In-memory rate limiting store (resets on function deployment)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

// Private IP ranges to block (SSRF protection)
const PRIVATE_IP_RANGES = [
  /^127\./,           // 127.0.0.0/8 (loopback)
  /^10\./,            // 10.0.0.0/8 (private)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (private)
  /^192\.168\./,      // 192.168.0.0/16 (private)
  /^169\.254\./,      // 169.254.0.0/16 (link-local)
  /^0\./,             // 0.0.0.0/8
  /^localhost$/i,
  /^::1$/,            // IPv6 loopback
  /^\[::1\]$/,
  /^fe80:/,           // IPv6 link-local
  /^fc00:/,           // IPv6 unique local
];

function isHttpUrl(u: string) {
  try { const p = new URL(u); return ["http:", "https:"].includes(p.protocol); }
  catch { return false; }
}

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_RANGES.some(range => range.test(hostname));
}

function checkRateLimit(clientIP: string): { allowed: boolean; resetTime?: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(clientIP);

  if (!existing || now > existing.resetTime) {
    // Reset or create new entry
    const newEntry = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(clientIP, newEntry);
    return { allowed: true };
  }

  if (existing.count >= RATE_LIMIT_REQUESTS) {
    return { allowed: false, resetTime: existing.resetTime };
  }

  existing.count++;
  return { allowed: true };
}

function getClientIP(event: { headers: Record<string, string | undefined> }): string {
  // Netlify provides the client IP in various headers
  return event.headers['x-nf-client-connection-ip'] ||
         event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         event.headers['x-real-ip'] ||
         'unknown';
}

/** Why the chain stopped early. Absent when the final destination was reached. */
export type ChainStopReason = 'redirect_loop' | 'max_hops' | 'timeout' | 'blocked' | 'network_error';

export interface ChainResult {
  resolvedUrl: string;
  hops: string[];
  /** True when the chain may be incomplete (stopped before a final 2xx/4xx). */
  partial: boolean;
  reason?: ChainStopReason;
}

export interface ChainOptions {
  maxHops?: number;
  perHopTimeoutMs?: number;
  overallDeadlineMs?: number;
}

function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Follow an HTTP redirect chain server-side and return the ordered hops.
 *
 * Every stop condition returns the partial chain gathered so far (with a
 * `reason`) rather than throwing — a shortener that loops or times out should
 * still surface the hops we did see. Every hop is treated as untrusted:
 * private/internal destinations stop the chain (SSRF), response bodies are
 * never downloaded (HEAD first, then a 1-byte ranged GET), and hops are capped.
 */
export async function followRedirectChain(url: string, options: ChainOptions = {}): Promise<ChainResult> {
  const maxHops = options.maxHops ?? MAX_HOPS;
  const perHopTimeout = options.perHopTimeoutMs ?? TIMEOUT_MS;
  const overallDeadline = options.overallDeadlineMs ?? OVERALL_DEADLINE_MS;

  const startTime = Date.now();
  const hops: string[] = [];
  const visited = new Set<string>();
  let current = url;

  for (let i = 0; i <= maxHops; i++) {
    if (i === maxHops) {
      return { resolvedUrl: current, hops, partial: true, reason: 'max_hops' };
    }

    if (Date.now() - startTime > overallDeadline) {
      return { resolvedUrl: current, hops, partial: true, reason: 'timeout' };
    }

    let urlObj: URL;
    try {
      urlObj = new URL(current);
    } catch {
      return { resolvedUrl: current, hops, partial: true, reason: 'network_error' };
    }

    // SSRF protection: never fetch private/internal hosts. The offending hop
    // is still recorded so the user can see where the chain was heading.
    if (isPrivateHost(urlObj.hostname)) {
      hops.push(current);
      return { resolvedUrl: current, hops, partial: true, reason: 'blocked' };
    }

    // Redirect loop detection
    const normalized = normalize(current);
    if (visited.has(normalized)) {
      return { resolvedUrl: current, hops, partial: true, reason: 'redirect_loop' };
    }
    visited.add(normalized);
    hops.push(current);

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), perHopTimeout);

    try {
      // First try HEAD request to get headers only
      let res = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": UA }
      });

      let loc = res.headers.get("location");

      // If HEAD didn't give us a redirect, try GET with range header to minimize data transfer
      if (!(res.status >= 300 && res.status < 400 && loc)) {
        res = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "user-agent": UA,
            "range": "bytes=0-0" // Request only first byte to minimize data transfer
          },
          cache: "no-store"
        });
        loc = res.headers.get("location");
      }

      clearTimeout(to);

      if (loc && res.status >= 300 && res.status < 400) {
        current = new URL(loc, current).toString();
        continue;
      }

      // Reached a non-redirect response: this is the final destination.
      return { resolvedUrl: current, hops, partial: false };
    } catch (error) {
      clearTimeout(to);
      // DOMException is not `instanceof Error` on every runtime — match by name
      const aborted = typeof error === 'object' && error !== null &&
        (error as { name?: string }).name === 'AbortError';
      return {
        resolvedUrl: current,
        hops,
        partial: true,
        reason: aborted ? 'timeout' : 'network_error'
      };
    }
  }

  return { resolvedUrl: current, hops, partial: true, reason: 'max_hops' };
}

export const handler: Handler = async (event) => {
  try {
    // Rate limiting check
    const clientIP = getClientIP(event);
    const rateLimitResult = checkRateLimit(clientIP);

    if (!rateLimitResult.allowed) {
      return {
        statusCode: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": Math.ceil((rateLimitResult.resetTime! - Date.now()) / 1000).toString()
        } as Record<string, string>,
        body: JSON.stringify({
          ok: false,
          error: "Rate limit exceeded",
          resetTime: rateLimitResult.resetTime
        })
      };
    }

    const { url } = JSON.parse(event.body || "{}");

    // Input validation
    if (!url || typeof url !== "string" || !isHttpUrl(url) || url.length > 2048) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" } as Record<string, string>,
        body: JSON.stringify({ ok: false, error: "Invalid URL format or length" })
      };
    }

    // Reject private/internal input outright (SSRF)
    if (isPrivateHost(new URL(url).hostname)) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" } as Record<string, string>,
        body: JSON.stringify({ ok: false, error: "Resolution of private addresses is not allowed" })
      };
    }

    const { resolvedUrl, hops, partial, reason } = await followRedirectChain(url);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, no-cache, must-revalidate",
        "pragma": "no-cache"
      } as Record<string, string>,
      body: JSON.stringify({
        ok: true,
        analysis: {
          input_url: url,
          redirect_chain: hops,
          resolved_url: resolvedUrl,
          hop_count: hops.length,
          partial,
          ...(reason ? { reason } : {})
        }
      })
    };
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "Resolution error";
    const statusCode = errorMessage.includes("Rate limit") ? 429 :
                      errorMessage.includes("Invalid URL") ? 400 : 500;

    return {
      statusCode: statusCode,
      headers: { "content-type": "application/json" } as Record<string, string>,
      body: JSON.stringify({
        ok: false,
        error: errorMessage
      })
    };
  }
};
