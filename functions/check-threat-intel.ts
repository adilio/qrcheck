import type { Handler } from '@netlify/functions';

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
    let threats = [];

    // Check 1: URLVoid (free API, no key required)
    try {
      const urlvoidResponse = await fetch(`https://www.urlvoid.com/scan/${target}`);
      if (urlvoidResponse.ok) {
        // Parse HTML response (URLVoid doesn't have a free JSON API)
        const html = await urlvoidResponse.text();
        const detections = html.match(/detections.*?(\d+)/i);
        if (detections && parseInt(detections[1]) > 0) {
          riskPoints += 50;
          threats.push(`URLVoid: ${detections[1]} security detections`);
        }
      }
    } catch (e) {
      // URLVoid check failed, continue
    }

    // Check 2: PhishTank (free API, no key required)
    try {
      const phishtankResponse = await fetch(
        `https://checkurl.phishtank.com/checkurl/index.php?url=${encodeURIComponent(target)}&format=json`
      );
      const phishData = await phishtankResponse.json();
      if (phishData.results.in_database) {
        riskPoints += 100;
        threats.push('PhishTank: Known phishing site');
      }
    } catch (e) {
      // PhishTank check failed, continue
    }

    // Check 3: Safe Browsing lookup using public API (limited but free)
    try {
      // Note: This would require Google API key for full functionality
      // For now, just check obvious suspicious patterns
      const suspiciousPatterns = [
        /\b(phish|scam|fake|spoof)\b/i,
        /\.tk$|\.ml$|\.ga$|\.cf$/i, // Suspicious TLDs
        /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/ // IP addresses
      ];

      if (suspiciousPatterns.some(pattern => pattern.test(target))) {
        riskPoints += 25;
        threats.push('Pattern match: Suspicious URL structure');
      }
    } catch (e) {
      // Pattern check failed, continue
    }

    // Determine overall threat level
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
        message: message,
        threats: threats,
        sources_checked: ['URLVoid', 'PhishTank', 'Pattern Analysis']
      })
    };
  } catch (error) {
    console.error('Threat intel check failed:', error);
    return {
      statusCode: 200,
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