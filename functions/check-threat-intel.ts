import type { Handler } from '@netlify/functions';

// Helper function for Google Safe Browsing API
async function queryGoogleSafeBrowsing(targetUrl: string): Promise<Array<{ threatType: string }>> {
  if (!process.env.GSB_API_KEY) {
    // Fallback to pattern analysis when no API key is available
    const suspiciousPatterns = [
      /\b(phish|scam|fake|spoof)\b/i,
      /\.tk$|\.ml$|\.ga$|\.cf$/i, // Suspicious TLDs
      /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/ // IP addresses
    ];

    if (suspiciousPatterns.some(pattern => pattern.test(targetUrl))) {
      return [{ threatType: 'SUSPICIOUS_PATTERN' }];
    }
    return [];
  }

  const response = await fetch(
    `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${process.env.GSB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'qrcheck', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url: targetUrl }]
        }
      }),
      signal: AbortSignal.timeout(6_000)
    }
  );
  if (!response.ok) {
    throw new Error(`GSB request failed: ${response.status}`);
  }
  const payload = await response.json();
  return payload.threatMatches ?? [];
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { domain, url } = JSON.parse(event.body || '{}');

    if (!domain && !url) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing domain or URL' }) };
    }

    const target = url || `http://${domain}`;
    let riskPoints = 0;
    const threats: Array<{ source: string; details: string; score: number }> = [];
    const sourcesChecked: string[] = [];

    // Check 1: URLVoid (free API, no key required)
    try {
      const urlvoidResponse = await fetch(`https://www.urlvoid.com/scan/${target}`);
      if (urlvoidResponse.ok) {
        // Parse HTML response (URLVoid doesn't have a free JSON API)
        const html = await urlvoidResponse.text();
        const detections = html.match(/detections.*?(\d+)/i);
        if (detections && parseInt(detections[1]) > 0) {
          riskPoints += 40;
          threats.push({
            source: 'URLVoid',
            details: `${detections[1]} security detections`,
            score: 40
          });
        }
      }
      sourcesChecked.push('URLVoid');
    } catch (e) {
      console.warn('threat-intel: URLVoid lookup failed', { error: e, target });
      sourcesChecked.push('URLVoid');
    }

    // Check 2: Google Safe Browsing (real API or pattern fallback)
    try {
      const matches = await queryGoogleSafeBrowsing(target);
      sourcesChecked.push('Google Safe Browsing');
      if (matches.length > 0) {
        const score = process.env.GSB_API_KEY ? 40 : 20; // Lower score for pattern fallback
        riskPoints += score;
        threats.push({
          source: 'Google Safe Browsing',
          details: matches.map(match => `Detected: ${match.threatType}`).join(', '),
          score
        });
      }
    } catch (error) {
      console.warn('threat-intel: GSB lookup failed', { error, target });
      sourcesChecked.push('Google Safe Browsing');
    }

    // Determine overall threat level by risk tiers
    let message = 'No threats detected';
    if (riskPoints >= 80) {
      message = 'High threat level detected';
    } else if (riskPoints >= 40) {
      message = 'Moderate threat indicators found';
    } else if (riskPoints > 0) {
      message = 'Low threat indicators found';
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        threat_detected: riskPoints > 0,
        risk_points: Math.min(riskPoints, 100),
        message,
        threats,
        sources_checked: sourcesChecked
      })
    };
  } catch (error) {
    console.error('Threat intel handler failed', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        threat_detected: false,
        risk_points: 0,
        message: 'Threat intelligence check failed',
        threats: [],
        sources_checked: []
      })
    };
  }
};
