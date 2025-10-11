const base = import.meta.env.VITE_API_BASE;

export interface ResolveResponse {
  hops: string[];
  final: string;
}

export interface IntelResponse {
  urlhaus: any;
  phishtank: any;
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
  if (!base) {
    return await resolveChainLocally(url);
  }
  try {
    const response = await fetch(`${base}/resolve?url=${encodeURIComponent(url)}`, {
      headers: { accept: 'application/json' }
    });
    const data = await response.json();
    if (!validateResolveResponse(data)) throw new Error('Invalid API response');
    return data;
  } catch (err) {
    console.warn('API redirect check failed, falling back to local:', err);
    return await resolveChainLocally(url);
  }
}

async function resolveChainLocally(url: string): Promise<ResolveResponse> {
  const hops: string[] = [url];
  let currentUrl = url;
  let maxRedirects = 10; // Prevent infinite redirect loops
  let redirectCount = 0;

  try {
    while (redirectCount < maxRedirects) {
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual' // We'll handle redirects manually
      });

      const locationHeader = response.headers.get('location');
      if (!locationHeader) {
        // No more redirects
        break;
      }

      // Handle relative redirects
      if (locationHeader.startsWith('/')) {
        const urlObj = new URL(currentUrl);
        currentUrl = `${urlObj.protocol}//${urlObj.host}${locationHeader}`;
      } else if (locationHeader.startsWith('http')) {
        currentUrl = locationHeader;
      } else {
        // Handle relative redirects
        currentUrl = new URL(locationHeader, currentUrl).href;
      }

      // Check if we've seen this URL before (redirect loop)
      if (hops.includes(currentUrl)) {
        break;
      }

      hops.push(currentUrl);
      redirectCount++;
    }
  } catch (err) {
    console.warn('Local redirect resolution failed:', err);
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
