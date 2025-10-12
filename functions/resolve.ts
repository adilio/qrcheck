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
  /^::1$/,            // IPv6 loopback
  /^fe80:/,           // IPv6 link-local
  /^fc00:/,           // IPv6 unique local
];

function isHttpUrl(u: string) {
  try { const p = new URL(u); return ["http:", "https:"].includes(p.protocol); }
  catch { return false; }
}

function isPrivateIP(hostname: string): boolean {
  // Check if hostname is an IP address and if it's private
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

function getClientIP(event: { headers: Record<string, string> }): string {
  // Netlify provides the client IP in various headers
  return event.headers['x-nf-client-connection-ip'] ||
         event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         event.headers['x-real-ip'] ||
         'unknown';
}

async function resolveChain(url: string, startTime: number): Promise<{ resolvedUrl: string; hops: string[] }> {
  const hops: string[] = [];
  let current = url;

  for (let i = 0; i < MAX_HOPS; i++) {
    // Check overall deadline
    if (Date.now() - startTime > OVERALL_DEADLINE_MS) {
      throw new Error("Overall deadline exceeded");
    }

    // Parse URL and check for private IPs
    let urlObj: URL;
    try {
      urlObj = new URL(current);
    } catch {
      return { resolvedUrl: current, hops };
    }

    // SSRF protection: block private/internal IPs
    if (isPrivateIP(urlObj.hostname)) {
      throw new Error("Resolution to private IP addresses is not allowed");
    }

    hops.push(current);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

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

      return { resolvedUrl: current, hops };
    } catch (error) {
      clearTimeout(to);
      if (error instanceof Error && error.message === "Overall deadline exceeded") {
        throw error;
      }
      return { resolvedUrl: current, hops };
    }
  }

  return { resolvedUrl: current, hops };
}

export const handler: Handler = async (event) => {
  const startTime = Date.now();

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
        },
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Invalid URL format or length" })
      };
    }

    const { resolvedUrl, hops } = await resolveChain(url, startTime);

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, no-cache, must-revalidate",
        "pragma": "no-cache"
      },
      body: JSON.stringify({
        ok: true,
        analysis: {
          input_url: url,
          redirect_chain: hops,
          resolved_url: resolvedUrl,
          hop_count: hops.length
        }
      })
    };
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "Resolution error";
    const statusCode = errorMessage.includes("Rate limit") ? 429 :
                      errorMessage.includes("Invalid URL") ? 400 : 500;

    return {
      statusCode: statusCode,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: errorMessage
      })
    };
  }
};