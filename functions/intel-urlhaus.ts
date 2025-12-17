import type { Handler } from "@netlify/functions";

// Use a mainstream browser UA to avoid URLHaus "verify user agent" redirects that break POST lookups
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 QRCheck/Intel";
const URLHAUS_URL = "https://urlhaus.abuse.ch/api/v1/url/";
const URLHAUS_HOST = "https://urlhaus.abuse.ch/api/v1/host/";
const TIMEOUT_MS = 4500;

function normalizeHost(u: string): string | null {
  try {
    const p = new URL(u);
    if (!["http:", "https:"].includes(p.protocol)) return null;
    return p.hostname.toLowerCase();
  } catch { return null; }
}

async function postForm(endpoint: string, form: Record<string, string>, signal: AbortSignal) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: new URLSearchParams(form).toString(),
      redirect: "follow",
      signal
    });

    // URLHaus occasionally responds with a 307 to a "verify user agent" page; treat that as a soft miss
    if (res.status >= 300 && res.status < 400) {
      return { query_status: "no_results", urls: [], records: [] };
    }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const text = await res.text();

  // URLHaus sometimes replies with a plain "no" body after verify-ua; treat as no results instead of an error
  if (text.trim().toLowerCase() === "no") {
    return { query_status: "no_results", urls: [], records: [] };
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse URLHaus response:', text, e);
    return { query_status: "failed", raw: text };
  }
}

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const inputUrl = typeof body.url === "string" ? body.url : null;
    const inputHost = typeof body.host === "string" ? body.host : null;
    if (!inputUrl && !inputHost) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "missing url or host" }) };
    }

    let host = inputHost;
    if (!host && inputUrl) {
      host = normalizeHost(inputUrl);
      if (!host) return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid url" }) };
    }

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    const result = inputUrl
      ? await postForm(URLHAUS_URL, { url: inputUrl }, ctrl.signal)
      : await postForm(URLHAUS_HOST, { host: host! }, ctrl.signal);

    clearTimeout(to);

    const matches = Array.isArray(result?.urls) ? result.urls
      : Array.isArray(result?.records) ? result.records
      : [];

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "netlify-cdn-cache-control": "public, s-maxage=300, stale-while-revalidate=60"
      },
      body: JSON.stringify({ ok: true, source: "urlhaus", query_status: result?.query_status || "failed", matches })
    };
  } catch (e: any) {
    console.error('URLHaus lookup failed:', e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e?.message || "lookup error" }) };
  }
};
