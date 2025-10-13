import fs from "node:fs/promises";
import path from "node:path";
import { request } from "undici";

const FEEDS = [
  "https://urlhaus.abuse.ch/downloads/csv_recent/",
  "https://urlhaus.abuse.ch/downloads/csv_online/"
];

async function fetchText(url) {
  const res = await request(url, { headers: { "user-agent": "QRCheck-Intel/1.0" } });
  if (res.statusCode !== 200) throw new Error(`fetch failed ${res.statusCode}`);
  return res.body.text();
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l && !l.startsWith("#"));
  const urls = [];
  for (const l of lines) {
    const cols = l.split('","').map(s => s.replace(/^"+|"+$/g, ""));
    const u = cols[2] || cols[1] || "";
    if (u.startsWith("http")) urls.push(u);
  }
  return urls;
}

function host(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } }

async function main() {
  const outDir = "public/urlhaus";
  await fs.mkdir(outDir, { recursive: true });

  const urls = new Set();
  for (const f of FEEDS) {
    const text = await fetchText(f);
    for (const u of parseCsv(text)) urls.add(u);
  }

  const hosts = new Set();
  for (const u of urls) { const h = host(u); if (h) hosts.add(h); }

  const payload = {
    updatedAt: new Date().toISOString(),
    count: hosts.size,
    hosts: [...hosts].sort()
  };

  await fs.writeFile(path.join(outDir, "hosts.json"), JSON.stringify(payload));
}

main().catch(e => { console.error(e); process.exit(1); });