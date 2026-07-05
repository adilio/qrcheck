#!/usr/bin/env node

/**
 * Prebuild script for QRCheck
 * Fetches threat intelligence data at build time instead of committing to git
 *
 * This script runs before every Netlify build to fetch fresh:
 * - URLHaus malicious hosts database
 * - URL shortener domain lists
 */

import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBloomFilter } from './bloom.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '../public');

/**
 * Fetch and process URLHaus malicious hosts database
 */
async function fetchURLHaus() {
  console.log('📡 Fetching URLHaus data...');

  try {
    // Fetch both recent and online malicious URL feeds
    const responses = await Promise.all([
      fetch('https://urlhaus.abuse.ch/downloads/csv_recent/'),
      fetch('https://urlhaus.abuse.ch/downloads/csv_online/')
    ]);

    // Check for HTTP errors
    for (const response of responses) {
      if (!response.ok) {
        throw new Error(`URLHaus API returned ${response.status}`);
      }
    }

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
      fetch('https://raw.githubusercontent.com/korlabsio/urlshortener/refs/heads/main/names.txt'),
      fetch('https://raw.githubusercontent.com/PeterDaveHello/url-shorteners/refs/heads/master/list')
    ]);

    // Check for HTTP errors
    for (const response of responses) {
      if (!response.ok) {
        throw new Error(`Shortener source returned ${response.status}`);
      }
    }

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

  try {
    // Fetch all data sources in parallel
    await Promise.all([
      fetchURLHaus(),
      fetchShorteners()
    ]);

    const duration = Date.now() - startTime;
    console.log(`\n✅ Data sync complete in ${duration}ms!`);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Data sync failed:', error);
    console.error('\nNote: Build will continue with existing cached data if available.');

    // Exit with error code to fail the build
    // This ensures we don't deploy with stale/missing data
    process.exit(1);
  }
}

// Run prebuild
prebuild();
