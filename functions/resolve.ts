import type { Handler } from "@netlify/functions";
import { fetch as undiciFetch, Agent } from "undici";
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";

const UA = "QRCheck-LinkResolver/1.0 (+https://qrcheck.ca)";
const MAX_HOPS = 10;
const TIMEOUT_MS = 5000;
const OVERALL_DEADLINE_MS = 10000;

/** Error code attached when a lookup resolves to a blocked address. */
export const BLOCKED_CODE = "EPRIVATEADDR";

// In-memory rate limiting store (resets on function deployment)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function inCidr4(ipInt: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

// Non-routable / internal IPv4 space the resolver must never contact.
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],        // "this network"
  ["10.0.0.0", 8],       // private
  ["100.64.0.0", 10],    // CGNAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local (incl. cloud metadata)
  ["172.16.0.0", 12],    // private
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.0.2.0", 24],     // TEST-NET-1
  ["192.168.0.0", 16],   // private
  ["198.18.0.0", 15],    // benchmarking
  ["198.51.100.0", 24],  // TEST-NET-2
  ["203.0.113.0", 24],   // TEST-NET-3
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4]       // reserved + broadcast
];

/** Expand an IPv6 address into its eight 16-bit groups, or null if malformed. */
function expandIpv6(ip: string): number[] | null {
  // Embedded IPv4 tail (e.g. ::ffff:127.0.0.1)
  let addr = ip;
  const v4Match = addr.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const v4 = ipv4ToInt(v4Match[1]);
    if (v4 === null) return null;
    addr = addr.slice(0, -v4Match[1].length) +
      ((v4 >>> 16).toString(16)) + ":" + ((v4 & 0xffff).toString(16));
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 && missing < 0) return null;
  if (halves.length === 1 && head.length !== 8) return null;

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;

  const parsed: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    parsed.push(parseInt(g, 16));
  }
  return parsed;
}

/**
 * True when a literal IP address is loopback, private, link-local, metadata,
 * multicast, or otherwise non-public. Works on IPv4 and IPv6 (including
 * IPv4-mapped and NAT64 forms).
 */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const family = isIP(bare);

  if (family === 4) {
    const v4 = ipv4ToInt(bare);
    if (v4 === null) return true; // unparseable: refuse
    return BLOCKED_V4.some(([base, prefix]) => inCidr4(v4, base, prefix));
  }

  if (family === 6) {
    const groups = expandIpv6(bare);
    if (!groups) return true; // unparseable: refuse

    const asInt = (hi: number, lo: number) => hi * 0x10000 + lo;
    const allZero = groups.every((g) => g === 0);
    if (allZero) return true; // ::
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1

    // IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96): judge the embedded IPv4
    const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
    const isNat64 = groups[0] === 0x64 && groups[1] === 0xff9b &&
      groups.slice(2, 6).every((g) => g === 0);
    if (isMapped || isNat64) {
      const v4 = asInt(groups[6], groups[7]);
      return BLOCKED_V4.some(([base, prefix]) => inCidr4(v4, base, prefix));
    }

    if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation
    return false;
  }

  return false; // not an IP literal
}

/**
 * True when a URL hostname must never be fetched: localhost-style names and
 * literal non-public IPs. DNS names pass here and are validated at connect
 * time by the pinning lookup (see makeSsrfLookup).
 */
export function isPrivateHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$/i.test(bare) || /\.localhost$/i.test(bare)) return true;
  if (isIP(bare)) return isPrivateAddress(bare);
  return false;
}

type DnsLookupFn = typeof dnsLookup;

/**
 * Build a `lookup` function for net/tls.connect that resolves a hostname,
 * rejects the connection if ANY resulting address is non-public, and pins the
 * connection to a validated address. Because validation happens inside the
 * same lookup the socket uses, a rebinding DNS server cannot swap in a private
 * address between validation and connect.
 */
export function makeSsrfLookup(dns: DnsLookupFn = dnsLookup) {
  return function ssrfLookup(
    hostname: string,
    options: { family?: number | string; all?: boolean },
    callback: (
      err: NodeJS.ErrnoException | null,
      address?: string | Array<{ address: string; family: number }>,
      family?: number
    ) => void
  ): void {
    dns(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = (Array.isArray(addresses) ? addresses : []) as Array<{ address: string; family: number }>;
      if (list.length === 0) {
        const e: NodeJS.ErrnoException = new Error(`No addresses found for ${hostname}`);
        e.code = "ENOTFOUND";
        return callback(e);
      }
      const blocked = list.find((a) => isPrivateAddress(a.address));
      if (blocked) {
        const e: NodeJS.ErrnoException = new Error(
          `Refusing to connect: ${hostname} resolves to non-public address ${blocked.address}`
        );
        e.code = BLOCKED_CODE;
        return callback(e);
      }
      if (options?.all) return callback(null, list);
      const wanted = options?.family === 6 || options?.family === 'IPv6' ? 6
        : options?.family === 4 || options?.family === 'IPv4' ? 4 : undefined;
      const preferred = list.find((a) => a.family === wanted) ?? list[0];
      callback(null, preferred.address, preferred.family);
    });
  };
}

// One agent for the function's lifetime: every connection it opens goes
// through the validating, pinning lookup above.
const ssrfSafeAgent = new Agent({
  connect: { lookup: makeSsrfLookup() as unknown as import("node:net").LookupFunction }
});

interface MinimalResponse {
  status: number;
  headers: { get(name: string): string | null };
}

type FetchLike = (url: string, init: {
  method: string;
  redirect: "manual";
  signal: AbortSignal;
  headers: Record<string, string>;
}) => Promise<MinimalResponse>;

const safeFetch: FetchLike = (url, init) =>
  undiciFetch(url, { ...init, dispatcher: ssrfSafeAgent }) as Promise<MinimalResponse>;

function isBlockedError(error: unknown): boolean {
  let e = error as { code?: string; cause?: unknown } | null;
  for (let depth = 0; e && depth < 5; depth++) {
    if (e.code === BLOCKED_CODE) return true;
    e = e.cause as { code?: string; cause?: unknown } | null;
  }
  return false;
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

function isHttpUrl(u: string) {
  try { const p = new URL(u); return ["http:", "https:"].includes(p.protocol); }
  catch { return false; }
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
  /** Transport override for tests. Production uses the SSRF-pinning agent. */
  fetchImpl?: FetchLike;
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
 * private/internal destinations stop the chain before any connection is made
 * (literal IPs are checked here; DNS names are resolved and validated inside
 * the connection agent, which also pins the socket to the validated address so
 * rebinding cannot bypass the check). Response bodies are never downloaded:
 * hops are probed with HEAD only, and a 1-byte ranged GET is issued solely
 * when a server rejects HEAD outright (405/501).
 */
export async function followRedirectChain(url: string, options: ChainOptions = {}): Promise<ChainResult> {
  const maxHops = options.maxHops ?? MAX_HOPS;
  const perHopTimeout = options.perHopTimeoutMs ?? TIMEOUT_MS;
  const overallDeadline = options.overallDeadlineMs ?? OVERALL_DEADLINE_MS;
  const fetchImpl = options.fetchImpl ?? safeFetch;

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

    // SSRF protection, layer 1: never fetch localhost or literal private IPs.
    // The offending hop is still recorded so the user can see where the chain
    // was heading. (Layer 2 — DNS names resolving to private space — is
    // enforced by the agent's pinning lookup and lands in the catch below.)
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
      // HEAD only: headers are all we need, and destination pages must never
      // receive an automatic content request.
      let res = await fetchImpl(current, {
        method: "HEAD",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": UA }
      });

      // Only when the server refuses the HEAD method itself, retry with a
      // 1-byte ranged GET. Any other HEAD response is taken at face value.
      if (res.status === 405 || res.status === 501) {
        res = await fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "user-agent": UA,
            "range": "bytes=0-0" // Request only first byte to minimize data transfer
          }
        });
      }

      clearTimeout(to);

      const loc = res.headers.get("location");
      if (loc && res.status >= 300 && res.status < 400) {
        current = new URL(loc, current).toString();
        continue;
      }

      // Reached a non-redirect response: this is the final destination.
      return { resolvedUrl: current, hops, partial: false };
    } catch (error) {
      clearTimeout(to);
      // The pinning lookup rejected a DNS name that resolves to private space.
      if (isBlockedError(error)) {
        return { resolvedUrl: current, hops, partial: true, reason: 'blocked' };
      }
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
