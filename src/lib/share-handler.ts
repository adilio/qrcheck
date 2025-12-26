export function handleShareTarget(): string | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);

  // Check if this is a share target request
  if (params.has('share-target') || params.get('source') === 'share') {
    const sharedUrl = params.get('url') || params.get('text') || '';

    if (sharedUrl) {
      // Extract URL from text if it contains one
      const urlMatch = sharedUrl.match(/https?:\/\/[^\s]+/);
      const extractedUrl = urlMatch ? urlMatch[0] : sharedUrl;

      // Clean up URL params
      window.history.replaceState({}, '', '/');

      return extractedUrl;
    }
  }

  return null;
}

export async function shareResults(url: string, verdict: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return false;
  }

  try {
    await navigator.share({
      title: 'QRCheck Security Report',
      text: `URL: ${url}\nVerdict: ${verdict}`,
      url: window.location.origin
    });
    return true;
  } catch (error) {
    // User cancelled or share failed
    return false;
  }
}
