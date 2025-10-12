const base = import.meta.env.VITE_API_BASE;

export interface ResolveResponse {
  hops: string[];
  final: string;
}

export interface ResolveAnalysisResponse {
  ok: boolean;
  analysis?: {
    input_url: string;
    redirect_chain: string[];
    resolved_url: string;
    hop_count: number;
  };
  error?: string;
}

export interface IntelResponse {
  urlhaus: unknown;
  phishtank: unknown;
}

function validateResolveResponse(d: unknown): d is ResolveResponse {
  if (!d || typeof d !== 'object') return false;
  const data = d as Record<string, unknown>;
  return Array.isArray(data.hops) && typeof data.final === 'string';
}

export async function resolveChain(url: string): Promise<ResolveResponse> {
  if (!/^https?:/i.test(url)) {
    return { hops: [url], final: url };
  }

  // Try the new Netlify function first
  try {
    const netlifyResult = await resolveWithNetlifyFunction(url);
    if (netlifyResult) {
      return netlifyResult;
    }
  } catch (err) {
    console.warn('Netlify function resolution failed, falling back to local:', err);
  }

  // Fallback to existing logic
  if (!base) {
    return await resolveChainWithFallback(url);
  }
  try {
    const response = await fetch(`${base}/resolve?url=${encodeURIComponent(url)}`, {
      headers: { accept: 'application/json' }
    });
    const data = await response.json();
    if (!validateResolveResponse(data)) throw new Error('Invalid API response');
    return data;
  } catch (err) {
    console.warn('API redirect check failed, falling back to enhanced local:', err);
    return await resolveChainWithFallback(url);
  }
}

async function resolveWithNetlifyFunction(url: string): Promise<ResolveResponse | null> {
  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      throw new Error(`Netlify function returned ${response.status}`);
    }

    const data: ResolveAnalysisResponse = await response.json();

    if (!data.ok || !data.analysis) {
      throw new Error(data.error || 'Invalid response from Netlify function');
    }

    return {
      hops: data.analysis.redirect_chain,
      final: data.analysis.resolved_url
    };
  } catch (err) {
    console.warn('Netlify function resolution failed:', err);
    return null;
  }
}

async function resolveChainWithFallback(url: string): Promise<ResolveResponse> {
  // First, try the enhanced local resolution
  const localResult = await resolveChainLocally(url);

  // If local resolution failed and it's a known shortener, try CORS proxy
  if (localResult.hops.length === 1) {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    const knownShorteners = ['bit.ly', 'tinyurl.com', 't.co', 'qrco.de', 'buff.ly', 'goo.gl', 'ow.ly', 'tiny.cc'];

    if (knownShorteners.some(shortener => domain.includes(shortener))) {
      console.info(`Local resolution failed for ${domain}, trying CORS proxy...`);

      try {
        const proxyResult = await resolveViaProxy(url);
        if (proxyResult.hops.length > 1) {
          console.info(`CORS proxy successfully expanded ${domain}`);
          return proxyResult;
        }
      } catch (err) {
        console.warn(`CORS proxy also failed for ${domain}:`, err);
      }
    }
  }

  return localResult;
}

async function resolveViaProxy(url: string): Promise<ResolveResponse> {
  // Try multiple proxy services in order of reliability
  const proxies = [
    {
      name: 'AllOrigins',
      url: (target: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
      extractFinalUrl: async (response: Response) => {
        // This proxy doesn't give us the final URL, so we can't use it for redirect detection
        throw new Error('Proxy does not expose final URL');
      }
    },
    {
      name: 'CORS IO',
      url: (target: string) => `https://cors.io/?${encodeURIComponent(target)}`,
      extractFinalUrl: async (response: Response) => {
        // This proxy also doesn't reliably expose final URLs
        throw new Error('Proxy does not expose final URL');
      }
    }
  ];

  // Try a different approach - use a fetch-based redirect detector
  return await detectRedirectsViaFetch(url);
}

async function detectRedirectsViaFetch(url: string): Promise<ResolveResponse> {
  const hops: string[] = [url];
  let currentUrl = url;
  const maxRedirects = 10;
  let redirectCount = 0;

  // Use a service that can follow redirects and return the final URL
  try {
    // We can use a combination of fetch with no-cors mode and manual redirect handling
    // But this is limited by browser security

    // For now, let's try using the finalurl.org service (if it exists)
    // or create a simple approach that at least tells us there's a redirect

    const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {
      method: 'HEAD',
      mode: 'cors'
    });

    // If we get here, we got some response, but we can't see redirects
    // So we'll have to return the original URL but indicate we know it's a shortener

    return {
      hops: [url],
      final: url
    };
  } catch (error) {
    // If even the proxy fails, return the original
    return {
      hops: [url],
      final: url
    };
  }
}

async function resolveChainLocally(url: string): Promise<ResolveResponse> {
  const hops: string[] = [url];
  let currentUrl = url;
  const maxRedirects = 10; // Prevent infinite redirect loops
  let redirectCount = 0;

  try {
    while (redirectCount < maxRedirects) {
      // Try HEAD first, fall back to GET if needed (some shorteners require GET)
      let response: Response;
      let locationHeader: string | null = null;

      try {
        response = await fetch(currentUrl, {
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });
        locationHeader = response.headers.get('location');
      } catch (headError) {
        console.debug('HEAD request failed, trying GET:', headError);
      }

      // If HEAD didn't give us a location, try GET
      if (!locationHeader) {
        try {
          response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(5000)
          });
          locationHeader = response.headers.get('location');
        } catch (getError) {
          console.debug('GET request also failed:', getError);

          // For known shorteners, provide a helpful message about redirect expansion
          if (redirectCount === 0) {
            const urlObj = new URL(currentUrl);
            const domain = urlObj.hostname.toLowerCase();
            const knownShorteners = ['bit.ly', 'tinyurl.com', 't.co', 'qrco.de', 'buff.ly', 'goo.gl', 'ow.ly', 'tiny.cc'];
            if (knownShorteners.some(shortener => domain.includes(shortener))) {
              console.info(`Redirect expansion blocked by CORS for ${domain}. This is expected for some shorteners.`);
            }
          }
          break;
        }
      }

      if (!locationHeader) {
        // No more redirects
        break;
      }

      // Handle different types of redirects
      try {
        if (locationHeader.startsWith('http')) {
          currentUrl = locationHeader;
        } else {
          // Handle relative redirects
          currentUrl = new URL(locationHeader, currentUrl).href;
        }
      } catch (urlError) {
        console.warn('Invalid redirect URL:', locationHeader, urlError);
        break;
      }

      // Check if we've seen this URL before (redirect loop)
      if (hops.includes(currentUrl)) {
        console.warn('Redirect loop detected');
        break;
      }

      hops.push(currentUrl);
      redirectCount++;
    }
  } catch (err) {
    console.warn('Local redirect resolution failed:', err);
  }

  // If we couldn't resolve redirects but it's a known shortener, add a note
  if (hops.length === 1 && redirectCount === 0) {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    const knownShorteners = ['bit.ly', 'tinyurl.com', 't.co', 'qrco.de', 'buff.ly', 'goo.gl', 'ow.ly', 'tiny.cc'];
    if (knownShorteners.some(shortener => domain.includes(shortener))) {
      console.info(`This is a shortened URL from ${domain}. Redirect expansion may be limited by browser security policies.`);
    }
  }

  return {
    hops,
    final: hops[hops.length - 1] || url
  };
}

export async function intel(url: string): Promise<IntelResponse> {
  if (!base) return { urlhaus: null, phishtank: null };
  const response = await fetch(`${base}/intel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ url })
  });
  return response.json();
}
