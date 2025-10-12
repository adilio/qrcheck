import { request } from "undici";
import fs from "node:fs/promises";
import path from "node:path";

const SOURCES = [
  { id: "korlabsio", url: "https://raw.githubusercontent.com/korlabsio/urlshortener/refs/heads/main/names.txt" },
  { id: "peterdavehello", url: "https://raw.githubusercontent.com/PeterDaveHello/url-shorteners/refs/heads/master/list" }
];

const LOCK_FILE = "data/sources.lock.json";
const OUT_FILE = "public/shorteners.json";
const SCHEMA_FILE = "contracts/shorteners.schema.json";

// re-fetch at most every 12h per source to avoid noisy commits
const MIN_FETCH_INTERVAL_MS = 12 * 60 * 60 * 1000;

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

function parseLines(text) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function normalizeDomain(d) {
  return d.replace(/^\.+|\.+$/g, "").toLowerCase();
}

function isDomain(d) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d);
}

async function httpGet(url, etag, lastModified) {
  const headers = {};
  if (etag) headers["If-None-Match"] = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  const res = await request(url, { headers });
  if (res.statusCode === 304) return { notModified: true };
  const body = await res.body.text();

  return {
    status: res.statusCode,
    body,
    etag: res.headers.etag,
    lastModified: res.headers["last-modified"]
  };
}

async function main() {
  const lock = await readJson(LOCK_FILE, {});
  const domains = new Set();

  for (const src of SOURCES) {
    const prev = lock[src.id] || {};
    const recent = prev.fetchedAt && (Date.now() - Date.parse(prev.fetchedAt)) < MIN_FETCH_INTERVAL_MS;

    const res = recent
      ? { notModified: true }
      : await httpGet(src.url, prev.etag, prev.lastModified);

    if (res.notModified) {
      // keep previous metadata
    } else if (res.status === 200) {
      // parse domains from source text
      for (const line of parseLines(res.body)) {
        if (line.startsWith("#") || line.startsWith("//")) continue;
        const d = normalizeDomain(line);
        if (isDomain(d)) domains.add(d);
      }
      lock[src.id] = {
        etag: res.etag || prev.etag || null,
        lastModified: res.lastModified || prev.lastModified || null,
        fetchedAt: new Date().toISOString(),
        url: src.url
      };
    } else {
      console.error(`Fetch failed for ${src.id} with status ${res.status}`);
      // keep previous lock data and continue
    }
  }

  // If no new content fetched this run but we have prior output, preserve it
  const prior = await readJson(OUT_FILE, null);

  const list = domains.size > 0
    ? [...domains].sort()
    : (prior?.domains || []);

  const data = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: list.length,
    domains: list
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(data, null, 2));

  await fs.mkdir(path.dirname(LOCK_FILE), { recursive: true });
  await fs.writeFile(LOCK_FILE, JSON.stringify(lock, null, 2));

  // validate against schema
  const schema = JSON.parse(await fs.readFile(SCHEMA_FILE, "utf8"));
  const Ajv = (await import("ajv")).default;
  const addFormats = (await import("ajv-formats")).default;
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  if (!validate(data)) {
    console.error(validate.errors);
    process.exit(1);
  }

  // print stable hash to help workflow detect changes
  console.log(`domains=${data.count}`);
}

await main().catch(e => { console.error(e); process.exit(1); });