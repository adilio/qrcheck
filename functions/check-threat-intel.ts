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

function isIpAddress(input: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(input);
}

interface AbuseIpdbResult {
  abuseConfidenceScore: number;
  totalReports: number;
  lastReportedAt?: string;
  countryCode?: string;
  usageType?: string;
}

async function queryAbuseIpdb(ipAddress: string): Promise<AbuseIpdbResult | null> {
  const apiKey = process.env.ABUSEIPDB_API_KEY;
  if (!apiKey) {
    console.warn('threat-intel: ABUSEIPDB_API_KEY is not set, skipping lookup');
    return null;
  }

  const endpoint = new URL('https://api.abuseipdb.com/api/v2/check');
  endpoint.searchParams.set('ipAddress', ipAddress);
  endpoint.searchParams.set('maxAgeInDays', '90');

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Key: apiKey,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(6_000)
  });

  if (!response.ok) {
    throw new Error(`AbuseIPDB request failed: ${response.status}`);
  }

  const payload = await response.json();
  const data = payload?.data;
  if (!data) {
    return null;
  }

  return {
    abuseConfidenceScore: Number(data.abuseConfidenceScore) || 0,
    totalReports: Number(data.totalReports) || 0,
    lastReportedAt: data.lastReportedAt ?? undefined,
    countryCode: data.countryCode ?? undefined,
    usageType: data.usageType ?? undefined
  };
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
    const parsed = new URL(target);
    const hostname = parsed.hostname.toLowerCase();
    const hostIsIp = isIpAddress(hostname);
    let riskPoints = 0;
    const threats: Array<{ source: string; details: string; score: number }> = [];
    const sourcesChecked: string[] = [];
    // Check 1: Google Safe Browsing (real API or pattern fallback)
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

    // Check 2: AbuseIPDB (only for direct IP destinations)
    if (hostIsIp && process.env.ABUSEIPDB_API_KEY) {
      try {
        const abuse = await queryAbuseIpdb(hostname);
        sourcesChecked.push('AbuseIPDB');

        if (abuse) {
          const confidence = abuse.abuseConfidenceScore;
          const totalReports = abuse.totalReports;

          let score = 0;
          if (confidence >= 80 || totalReports >= 20) {
            score = 60;
          } else if (confidence >= 50 || totalReports >= 10) {
            score = 40;
          } else if (confidence >= 25 || totalReports >= 5) {
            score = 25;
          }

          if (score > 0) {
            riskPoints += score;
            const detailParts = [`Confidence ${confidence}/100`, `${totalReports} report${totalReports === 1 ? '' : 's'}`];
            if (abuse.countryCode) {
              detailParts.push(`Country ${abuse.countryCode}`);
            }
            if (abuse.lastReportedAt) {
              detailParts.push(`Last seen ${abuse.lastReportedAt}`);
            }
            threats.push({
              source: 'AbuseIPDB',
              details: `Malicious IP reputation: ${detailParts.join(', ')}`,
              score
            });
          }
        }
      } catch (error) {
        sourcesChecked.push('AbuseIPDB');
        console.warn('threat-intel: AbuseIPDB lookup failed', { error, target });
      }
    } else if (hostIsIp && !process.env.ABUSEIPDB_API_KEY) {
      console.warn('threat-intel: AbuseIPDB lookup skipped because ABUSEIPDB_API_KEY is undefined');
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
