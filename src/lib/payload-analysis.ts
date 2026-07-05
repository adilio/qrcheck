/**
 * Payload-type-aware risk analysis (F3)
 *
 * The decoder parses non-URL QR payloads (tel, sms, wifi, vcard, geo, mailto,
 * text) but historically only URLs were scored. This module gives every
 * payload type its own signal set feeding the tiered verdict.
 *
 * The verdict is strictly advisory: nothing here (or anywhere in the app)
 * auto-joins a network, dials a number, or sends a message. Unknown types
 * degrade to a neutral "can't assess" — never a false "safe".
 */

import type { QRContent } from './decode';
import { SUSPICIOUS_KEYWORDS } from '../data/keywords';

export interface PayloadCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  detail: string;
}

export interface PayloadAnalysis {
  checks: PayloadCheck[];
  scoreDelta: number;
  recommendations: string[];
}

const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;

/** Extract every http(s) URL from a text blob, de-duplicated, trailing punctuation trimmed. */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  return Array.from(new Set(matches.map((m) => m.replace(/[.,;:!?)\]]+$/, ''))));
}

/** Premium-rate patterns: NANP 900/976, UK 09xx and 118xx directory services. */
export function isPremiumRateNumber(num: string): boolean {
  const cleaned = num.replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/^\+/, '');
  if (/^1?(900|976)\d{7}$/.test(digits)) return true;
  if (/^44 ?9\d{8,9}$/.test(digits) || /^09\d{8,9}$/.test(digits) || /^449\d{8,9}$/.test(digits)) return true;
  if (/^118\d{2,3}$/.test(digits)) return true;
  return false;
}

/** 4-6 digit short codes — messages/calls may carry carrier charges. */
export function isShortCode(num: string): boolean {
  if (num.trim().startsWith('+')) return false;
  const digits = num.replace(/\D/g, '');
  return digits.length >= 4 && digits.length <= 6;
}

function keywordMatches(text: string): string[] {
  const lower = text.toLowerCase();
  return SUSPICIOUS_KEYWORDS.filter((k) => lower.includes(k.toLowerCase()));
}

function analyzeNumber(kind: 'phone' | 'sms', number: string, body: string | undefined, analysis: PayloadAnalysis) {
  const label = kind === 'phone' ? 'Phone number' : 'SMS recipient';

  if (isPremiumRateNumber(number)) {
    analysis.checks.push({
      id: `${kind}-premium`,
      label,
      status: 'fail',
      detail: `${number} matches a premium-rate pattern — calls/messages can incur high charges`
    });
    analysis.scoreDelta += 45;
    analysis.recommendations.push('This number matches a premium-rate pattern. Do not call or text it unless you know exactly what it is.');
  } else if (isShortCode(number)) {
    analysis.checks.push({
      id: `${kind}-shortcode`,
      label,
      status: 'warn',
      detail: `${number} is a short code — messages may trigger paid subscriptions`
    });
    analysis.scoreDelta += 15;
    analysis.recommendations.push('Short codes can sign you up for paid services. Verify the service before texting.');
  } else {
    analysis.checks.push({
      id: `${kind}-number`,
      label,
      status: 'pass',
      detail: `${number} looks like a standard number`
    });
  }

  if (kind === 'sms' && body) {
    const urls = extractUrls(body);
    if (urls.length > 0) {
      analysis.checks.push({
        id: 'sms-link',
        label: 'Message body',
        status: 'warn',
        detail: `Pre-filled message contains ${urls.length === 1 ? 'a link' : `${urls.length} links`}`
      });
      analysis.scoreDelta += 10;
      analysis.recommendations.push('The pre-filled message contains a link. Analyze it before sending or opening.');
    }
    const words = keywordMatches(body);
    if (words.length > 0) {
      analysis.checks.push({
        id: 'sms-keywords',
        label: 'Message wording',
        status: 'warn',
        detail: `Suspicious terms: ${words.join(', ')}`
      });
      analysis.scoreDelta += 10;
    }
  }
}

function analyzeWifi(content: QRContent, analysis: PayloadAnalysis) {
  const ssid = content.metadata?.ssid || content.text || 'Unknown network';
  const encryption = (content.metadata?.encryption || 'nopass').toUpperCase();

  // Always surface what the user would be joining, before they join it
  analysis.checks.push({
    id: 'wifi-ssid',
    label: 'Network (SSID)',
    status: 'info',
    detail: `"${ssid}" — security: ${encryption === 'NOPASS' ? 'none (open)' : encryption}`
  });

  if (encryption === 'NOPASS' || encryption === '') {
    analysis.checks.push({
      id: 'wifi-open',
      label: 'Network security',
      status: 'warn',
      detail: 'Open network — traffic is unencrypted and can be intercepted'
    });
    analysis.scoreDelta += 30;
    analysis.recommendations.push('This QR joins an OPEN WiFi network. Anyone nearby can observe your traffic; avoid logging into accounts on it.');
  } else if (encryption === 'WEP') {
    analysis.checks.push({
      id: 'wifi-wep',
      label: 'Network security',
      status: 'warn',
      detail: 'WEP encryption is obsolete and trivially crackable'
    });
    analysis.scoreDelta += 20;
    analysis.recommendations.push('This network uses WEP, which is effectively no protection. Treat it as an open network.');
  } else {
    analysis.checks.push({
      id: 'wifi-encrypted',
      label: 'Network security',
      status: 'pass',
      detail: `${encryption} encryption`
    });
  }

  analysis.recommendations.push('Verify the network name with the venue before joining — rogue hotspots imitate legitimate ones.');
}

function analyzeVcard(content: QRContent, analysis: PayloadAnalysis) {
  const name = content.metadata?.firstName || content.text || 'Contact';
  analysis.checks.push({
    id: 'vcard-name',
    label: 'Contact card',
    status: 'info',
    detail: `Contact: ${name}`
  });

  const urls = extractUrls(content.raw);
  if (urls.length > 0) {
    analysis.checks.push({
      id: 'vcard-link',
      label: 'Embedded link',
      status: 'warn',
      detail: `Card contains ${urls.length === 1 ? 'a link' : `${urls.length} links`} — verify before opening`
    });
    analysis.scoreDelta += 10;
    analysis.recommendations.push('This contact card embeds a link. Analyze it before opening.');

    const email = content.metadata?.email;
    if (email && email.includes('@')) {
      const emailDomain = email.split('@')[1]?.toLowerCase().trim();
      const linkHosts = urls
        .map((u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } })
        .filter((h): h is string => Boolean(h));
      const mismatch = emailDomain && linkHosts.length > 0 &&
        !linkHosts.some((h) => h === emailDomain || h.endsWith(`.${emailDomain}`) || emailDomain.endsWith(`.${h}`));
      if (mismatch) {
        analysis.checks.push({
          id: 'vcard-mismatch',
          label: 'Field consistency',
          status: 'warn',
          detail: `Email domain (${emailDomain}) doesn't match the card's link (${linkHosts[0]})`
        });
        analysis.scoreDelta += 15;
      }
    }
  }
}

function analyzeEmail(content: QRContent, analysis: PayloadAnalysis) {
  const address = content.text || '';
  const validAddress = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address);

  analysis.checks.push({
    id: 'email-address',
    label: 'Email address',
    status: validAddress ? 'pass' : 'warn',
    detail: validAddress ? address : `"${address}" is not a valid email address`
  });
  if (!validAddress) {
    analysis.scoreDelta += 10;
  }

  const subjectAndBody = `${content.metadata?.subject ?? ''} ${content.metadata?.body ?? ''}`.trim();
  if (subjectAndBody) {
    const words = keywordMatches(subjectAndBody);
    if (words.length > 0) {
      analysis.checks.push({
        id: 'email-keywords',
        label: 'Pre-filled content',
        status: 'warn',
        detail: `Suspicious terms in subject/body: ${words.join(', ')}`
      });
      analysis.scoreDelta += 20;
      analysis.recommendations.push('The pre-filled email uses wording common in phishing. Be careful what you send.');
    }
    const urls = extractUrls(subjectAndBody);
    if (urls.length > 0) {
      analysis.checks.push({
        id: 'email-link',
        label: 'Pre-filled content',
        status: 'warn',
        detail: `Contains ${urls.length === 1 ? 'a link' : `${urls.length} links`}`
      });
      analysis.scoreDelta += 10;
    }
  }
}

function analyzeGeo(content: QRContent, analysis: PayloadAnalysis) {
  const lat = content.metadata?.latitude;
  const lon = content.metadata?.longitude;
  const valid = typeof lat === 'number' && typeof lon === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  analysis.checks.push({
    id: 'geo-coords',
    label: 'Coordinates',
    status: valid ? 'pass' : 'warn',
    detail: valid ? `${lat}, ${lon} — within valid range` : 'Coordinates are malformed or out of range'
  });
  if (!valid) {
    analysis.scoreDelta += 10;
  }
  analysis.recommendations.push('Preview the location in your maps app before navigating anywhere.');
}

function analyzeText(content: QRContent, analysis: PayloadAnalysis) {
  const urls = extractUrls(content.raw);
  if (urls.length > 0) {
    analysis.checks.push({
      id: 'text-links',
      label: 'Embedded links',
      status: 'info',
      detail: `Contains ${urls.length === 1 ? '1 link' : `${urls.length} links`} — analyze before opening`
    });
  }

  const words = keywordMatches(content.raw);
  if (words.length > 0) {
    analysis.checks.push({
      id: 'text-keywords',
      label: 'Wording',
      status: 'warn',
      detail: `Suspicious terms: ${words.join(', ')}`
    });
    analysis.scoreDelta += 10;
  }

  if (urls.length === 0 && words.length === 0) {
    analysis.checks.push({
      id: 'text-plain',
      label: 'Plain text',
      status: 'pass',
      detail: 'No links or suspicious wording detected'
    });
  }
}

/**
 * Type-appropriate risk checks for non-URL payloads. URL payloads are handled
 * by the full URL engine in heuristics-tiered.ts and never reach this path.
 */
export function analyzePayload(content: QRContent): PayloadAnalysis {
  const analysis: PayloadAnalysis = { checks: [], scoreDelta: 0, recommendations: [] };

  switch (content.type) {
    case 'phone':
      analyzeNumber('phone', content.metadata?.phone || content.text, undefined, analysis);
      break;
    case 'sms':
      analyzeNumber('sms', content.metadata?.phone || content.text, content.metadata?.body, analysis);
      break;
    case 'wifi':
      analyzeWifi(content, analysis);
      break;
    case 'vcard':
      analyzeVcard(content, analysis);
      break;
    case 'email':
      analyzeEmail(content, analysis);
      break;
    case 'geo':
      analyzeGeo(content, analysis);
      break;
    case 'text':
      analyzeText(content, analysis);
      break;
    default:
      // Unknown types are "can't assess", never a false "safe"
      analysis.checks.push({
        id: 'unknown-type',
        label: 'Payload type',
        status: 'info',
        detail: 'Unrecognized payload — QRCheck cannot assess this content'
      });
      analysis.recommendations.push('This payload type cannot be assessed. Treat it with caution.');
      break;
  }

  return analysis;
}
