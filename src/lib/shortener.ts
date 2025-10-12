/**
 * URL Shortener Checker
 *
 * This module provides functionality to check if URLs use URL shortening services,
 * which can be used to obscure the terminal endpoint.
 */

export interface ShortenerData {
  version: number;
  generatedAt: string;
  count: number;
  domains: string[];
}

export interface ShortenerCheckResult {
  isShortener: boolean;
  domain: string | null;
  knownServices: string[];
}

/**
 * Loads shortener data from the JSON file
 */
export async function loadShortenerData(): Promise<ShortenerData> {
  try {
    const basePath = import.meta.env.BASE_URL ?? '/';
    const shortenersPath = basePath.endsWith('/')
      ? `${basePath}shorteners.json`
      : `${basePath}/shorteners.json`;

    const response = await fetch(shortenersPath, {
      headers: { accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`Failed to load shortener data: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error loading shortener data:', error);
    // Return empty data as fallback
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      count: 0,
      domains: []
    };
  }
}

/**
 * Checks if a URL uses a known URL shortening service
 */
export async function checkUrlShortener(url: string): Promise<ShortenerCheckResult> {
  try {
    // Extract domain from URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    
    // Load shortener data
    const shortenerData = await loadShortenerData();
    
    // Check against known domains
    const matchingDomain = shortenerData.domains.find(d => domain === d || domain.endsWith(`.${d}`));

    return {
      isShortener: !!matchingDomain,
      domain: matchingDomain || null,
      knownServices: shortenerData.domains
    };
  } catch (error) {
    console.error('Error checking URL shortener:', error);
    return {
      isShortener: false,
      domain: null,
      knownServices: []
    };
  }
}

/**
 * Checks multiple URLs for URL shorteners
 */
export async function checkMultipleUrls(urls: string[]): Promise<Map<string, ShortenerCheckResult>> {
  const results = new Map<string, ShortenerCheckResult>();
  
  // Load shortener data once for efficiency
  const shortenerData = await loadShortenerData();
  
  // Process each URL
  for (const url of urls) {
    try {
      // Extract domain from URL
      const urlObj = new URL(url);
      const domain = urlObj.hostname.toLowerCase();
      
      // Check against known domains
      const matchingDomain = shortenerData.domains.find(d => domain === d || domain.endsWith(`.${d}`));

      results.set(url, {
        isShortener: !!matchingDomain,
        domain: matchingDomain || null,
        knownServices: shortenerData.domains
      });
    } catch (error) {
      console.error(`Error checking URL ${url}:`, error);
      results.set(url, {
        isShortener: false,
        domain: null,
        knownServices: shortenerData.domains
      });
    }
  }
  
  return results;
}

/**
 * Gets metadata about the shortener database
 */
export async function getShortenerMetadata() {
  const data = await loadShortenerData();
  return {
    version: data.version,
    generatedAt: data.generatedAt,
    count: data.count
  };
}