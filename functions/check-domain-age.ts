import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { domain } = JSON.parse(event.body || '{}');

    if (!domain) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing domain' }) };
    }

    // Use RDAP - public, no API key required
    const rdapUrl = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
    const response = await fetch(rdapUrl, {
      headers: { Accept: 'application/rdap+json' }
    });

    if (!response.ok) {
      throw new Error(`RDAP lookup failed with status ${response.status}`);
    }

    const data = await response.json();

    // RDAP events array typically includes a registration/creation entry with eventDate
    const events: any[] = Array.isArray(data.events) ? data.events : [];
    const creationEvent = events.find((event: any) =>
      typeof event?.eventAction === 'string' &&
      ['registration', 'creation', 'registered'].includes(event.eventAction.toLowerCase())
    );
    const createdDate = creationEvent?.eventDate || data?.registrationDate || data?.created;

    if (!createdDate) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          age_days: null,
          risk_points: 0,
          message: 'Domain age could not be determined'
        })
      };
    }

    const ageInDays = Math.floor(
      (Date.now() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    let riskPoints = 0;
    let message = `Domain ${ageInDays} days old`;

    if (ageInDays < 30) {
      riskPoints = 20;
      message = `Very new domain (${ageInDays} days old)`;
    } else if (ageInDays < 90) {
      riskPoints = 10;
      message = `New domain (${ageInDays} days old)`;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        age_days: ageInDays,
        risk_points: riskPoints,
        message: message
      })
    };
  } catch (error) {
    console.error('Domain age check failed:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({
        age_days: null,
        risk_points: 0,
        message: 'Domain age check failed'
      })
    };
  }
};
