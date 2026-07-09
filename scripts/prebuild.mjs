#!/usr/bin/env node

/**
 * Prebuild script for QRCheck
 * Fetches threat intelligence data at build time instead of committing to git
 *
 * This script runs before every Netlify build to fetch fresh:
 * - URLHaus malicious hosts database
 * - URL shortener domain lists
 */

import { writeFile, mkdir, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBloomFilter } from './bloom.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '../public');

/**
 * Fetch with retry and linear backoff. Upstream sources (especially
 * raw.githubusercontent.com from shared CI IPs) intermittently return 429.
 */
async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        const delay = 2000 * (i + 1);
        console.warn(`⚠️ ${error.message} — retrying in ${delay / 1000}s (attempt ${i + 2}/${attempts})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch and process URLHaus malicious hosts database
 */
async function fetchURLHaus() {
  console.log('📡 Fetching URLHaus data...');

  try {
    // Fetch both recent and online malicious URL feeds
    const responses = await Promise.all([
      fetchWithRetry('https://urlhaus.abuse.ch/downloads/csv_recent/'),
      fetchWithRetry('https://urlhaus.abuse.ch/downloads/csv_online/')
    ]);

    const csvTexts = await Promise.all(responses.map(r => r.text()));
    const hosts = new Set();

    // Parse CSV data and extract hostnames
    for (const csv of csvTexts) {
      const lines = csv.split('\n');
      for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith('#') || !line.trim()) continue;

        // CSV format: id,dateadded,url,url_status,threat,tags,urlhaus_link,reporter
        const parts = line.split(',');

        // Extract URL (3rd column)
        if (parts[2]) {
          try {
            const urlString = parts[2].replace(/"/g, '');
            const url = new URL(urlString);
            hosts.add(url.hostname);
          } catch (e) {
            // Skip malformed URLs
            continue;
          }
        }
      }
    }

    // Build a compact Bloom filter instead of shipping the raw host list:
    // ~42 KB base64 versus ~352 KB of hostnames, O(k) membership checks.
    // FPR is 1e-4 (see scripts/bloom.mjs); the live URLHaus API remains the
    // authoritative check for any hit.
    const hostList = Array.from(hosts).sort().map((h) => h.toLowerCase());
    const { m, k, bytes } = buildBloomFilter(hostList);

    const data = {
      updatedAt: new Date().toISOString(),
      count: hostList.length,
      m,
      k,
      bits: Buffer.from(bytes).toString('base64')
    };

    // Ensure output directory exists
    await mkdir(join(publicDir, 'urlhaus'), { recursive: true });

    // Write to public directory (and drop the legacy raw host list if present)
    await writeFile(
      join(publicDir, 'urlhaus/bloom.json'),
      JSON.stringify(data)
    );
    await rm(join(publicDir, 'urlhaus/hosts.json'), { force: true });

    console.log(`✅ URLHaus: ${data.count} malicious hosts → ${(JSON.stringify(data).length / 1024).toFixed(1)} KB bloom filter (m=${m}, k=${k})`);
    return true;
  } catch (error) {
    console.error('❌ URLHaus fetch failed:', error.message);
    throw error;
  }
}

/**
 * Fetch and process URL shortener domain lists
 */
async function fetchShorteners() {
  console.log('📡 Fetching shortener lists...');

  try {
    // Fetch from multiple upstream sources
    const responses = await Promise.all([
      fetchWithRetry('https://raw.githubusercontent.com/korlabsio/urlshortener/refs/heads/main/names.txt'),
      fetchWithRetry('https://raw.githubusercontent.com/PeterDaveHello/url-shorteners/refs/heads/master/list')
    ]);

    const texts = await Promise.all(responses.map(r => r.text()));
    const domains = new Set();

    // Parse line-delimited domain lists
    for (const text of texts) {
      const lines = text.split('\n');
      for (const line of lines) {
        const domain = line.trim();
        // Skip comments and empty lines
        if (domain && !domain.startsWith('#')) {
          domains.add(domain);
        }
      }
    }

    // Generate output JSON
    const data = {
      version: 1,
      generatedAt: new Date().toISOString(),
      count: domains.size,
      domains: Array.from(domains).sort()
    };

    // Write to public directory
    await writeFile(
      join(publicDir, 'shorteners.json'),
      JSON.stringify(data, null, 2)
    );

    console.log(`✅ Shorteners: ${data.count} domains`);
    return true;
  } catch (error) {
    console.error('❌ Shortener fetch failed:', error.message);
    throw error;
  }
}

/**
 * Main prebuild function
 */
async function prebuild() {
  console.log('🔄 Syncing threat intelligence data...\n');

  const startTime = Date.now();

  // Fetch all data sources in parallel. A failed refresh is only fatal when
  // there is no existing data file to fall back on — a rate-limited upstream
  // (e.g. raw.githubusercontent.com returning 429) must not block deploys
  // that would otherwise ship slightly stale but perfectly usable data.
  const sources = [
    { name: 'URLHaus', run: fetchURLHaus, output: join(publicDir, 'urlhaus/bloom.json') },
    { name: 'Shorteners', run: fetchShorteners, output: join(publicDir, 'shorteners.json') }
  ];

  const results = await Promise.allSettled(sources.map((s) => s.run()));

  let fatal = false;
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      const source = sources[i];
      if (await fileExists(source.output)) {
        console.warn(`⚠️ ${source.name} refresh failed (${result.reason?.message}); deploying existing ${source.output}`);
      } else {
        console.error(`❌ ${source.name} fetch failed (${result.reason?.message}) and no existing data at ${source.output}`);
        fatal = true;
      }
    }
  }

  if (fatal) {
    console.error('\n❌ Data sync failed with no fallback data available.');
    process.exit(1);
  }

  const duration = Date.now() - startTime;
  console.log(`\n✅ Data sync complete in ${duration}ms!`);
  process.exit(0);
}

// Run prebuild
prebuild();
