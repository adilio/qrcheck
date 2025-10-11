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
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow'
      });

      const hops: string[] = [url];
      if (response.redirected && response.url && response.url !== url) {
        hops.push(response.url);
        return { hops, final: response.url };
      }

      return { hops, final: url };
    } catch (err) {
      console.warn('Local redirect check failed:', err);
      return { hops: [url], final: url };
    }
  }
  const response = await fetch(`${base}/resolve?url=${encodeURIComponent(url)}`, {
    headers: { accept: 'application/json' }
  });
  const data = await response.json();
  if (!validateResolveResponse(data)) throw new Error('Invalid API response');
  return data;
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
