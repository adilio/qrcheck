import type { Handler } from "@netlify/functions";

const UA = "QRCheck-LinkResolver/1.0 (+https://qrcheck.ca)";
const MAX_HOPS = 10;
const TIMEOUT_MS = 5000;

function isHttpUrl(u: string) {
  try { const p = new URL(u); return ["http:", "https:"].includes(p.protocol); }
  catch { return false; }
}

async function resolveChain(url: string): Promise<{ resolvedUrl: string; hops: string[] }> {
  const hops: string[] = [];
  let current = url;
  for (let i = 0; i < MAX_HOPS; i++) {
    hops.push(current);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      let res = await fetch(current, { method: "HEAD", redirect: "manual", signal: ctrl.signal, headers: { "user-agent": UA } });
      let loc = res.headers.get("location");
      if (!(res.status >= 300 && res.status < 400 && loc)) {
        res = await fetch(current, { method: "GET", redirect: "manual", signal: ctrl.signal, headers: { "user-agent": UA }, cache: "no-store" });
        loc = res.headers.get("location");
      }
      clearTimeout(to);
      if (loc && res.status >= 300 && res.status < 400) {
        current = new URL(loc, current).toString();
        continue;
      }
      return { resolvedUrl: current, hops };
    } catch {
      clearTimeout(to);
      return { resolvedUrl: current, hops };
    }
  }
  return { resolvedUrl: current, hops };
}

export const handler: Handler = async (event) => {
  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!url || typeof url !== "string" || !isHttpUrl(url) || url.length > 2048) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid url" }) };
    }
    const { resolvedUrl, hops } = await resolveChain(url);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
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
  } catch (e: any) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e?.message || "resolution error" }) };
  }
};