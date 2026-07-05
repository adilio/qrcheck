import { describe, it, expect } from 'vitest';
import { analyzePayload, extractUrls, isPremiumRateNumber, isShortCode } from '../../src/lib/payload-analysis';
import { parseQRContent } from '../../src/lib/decode';
import type { QRContent } from '../../src/lib/decode';

function byId(analysis: ReturnType<typeof analyzePayload>, id: string) {
  return analysis.checks.find((c) => c.id === id);
}

describe('extractUrls', () => {
  it('extracts and de-duplicates URLs, trimming trailing punctuation', () => {
    const urls = extractUrls('Go to https://a.example/page. Also https://b.example, and https://a.example/page!');
    expect(urls).toEqual(['https://a.example/page', 'https://b.example']);
  });

  it('returns empty for plain text', () => {
    expect(extractUrls('hello world')).toEqual([]);
  });
});

describe('premium-rate and short-code detection', () => {
  it.each([
    ['1-900-555-0199', true],
    ['+19005550199', true],
    ['9765550100', true],
    ['09098790000', true],
    ['118118', true],
    ['+14165550199', false],
    ['416-555-0199', false]
  ])('isPremiumRateNumber(%s) -> %s', (num, expected) => {
    expect(isPremiumRateNumber(num)).toBe(expected);
  });

  it('flags 4-6 digit short codes but not full numbers or international', () => {
    expect(isShortCode('55555')).toBe(true);
    expect(isShortCode('4165550199')).toBe(false);
    expect(isShortCode('+4915112345678')).toBe(false);
  });
});

describe('analyzePayload per type', () => {
  it('phone: flags premium-rate numbers as fail', () => {
    const content = parseQRContent('tel:+19005550199');
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'phone-premium')?.status).toBe('fail');
    expect(analysis.scoreDelta).toBeGreaterThanOrEqual(45);
  });

  it('phone: standard numbers pass', () => {
    const content = parseQRContent('tel:+14165550199');
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'phone-number')?.status).toBe('pass');
    expect(analysis.scoreDelta).toBe(0);
  });

  it('sms: warns on short codes and links in the body', () => {
    const content = parseQRContent('smsto:55555:Claim your prize at https://evil.example/win');
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'sms-shortcode')?.status).toBe('warn');
    expect(byId(analysis, 'sms-link')?.status).toBe('warn');
    expect(analysis.scoreDelta).toBeGreaterThanOrEqual(25);
  });

  it('wifi: surfaces SSID and warns on open networks', () => {
    const content = parseQRContent('WIFI:T:nopass;S:Free Airport WiFi;;');
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'wifi-ssid')?.detail).toContain('Free Airport WiFi');
    expect(byId(analysis, 'wifi-open')?.status).toBe('warn');
    expect(analysis.scoreDelta).toBe(30);
  });

  it('wifi: warns on WEP', () => {
    const content = parseQRContent('WIFI:T:WEP;S:OldRouter;P:12345;;');
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'wifi-wep')?.status).toBe('warn');
  });

  it('wifi: WPA networks pass', () => {
    const content = parseQRContent('WIFI:T:WPA;S:HomeNet;P:hunter2;;');
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'wifi-encrypted')?.status).toBe('pass');
    expect(analysis.scoreDelta).toBe(0);
  });

  it('vcard: flags embedded links and email/link domain mismatch', () => {
    const raw = 'BEGIN:VCARD\nVERSION:3.0\nFN:Support Team\nEMAIL:help@bank.example\nURL:https://evil.example/login\nEND:VCARD';
    const content = parseQRContent(raw);
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'vcard-link')?.status).toBe('warn');
    expect(byId(analysis, 'vcard-mismatch')?.status).toBe('warn');
    expect(analysis.scoreDelta).toBeGreaterThanOrEqual(25);
  });

  it('email: valid plain address passes', () => {
    const content = parseQRContent('mailto:hello@example.com');
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'email-address')?.status).toBe('pass');
    expect(analysis.scoreDelta).toBe(0);
  });

  it('email: warns on phishing wording in pre-filled subject', () => {
    const content = parseQRContent('mailto:x@example.com?subject=Verify%20your%20account%20login');
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'email-keywords')?.status).toBe('warn');
  });

  it('geo: valid coordinates pass, invalid warn', () => {
    const valid = analyzePayload(parseQRContent('geo:43.65,-79.38'));
    expect(byId(valid, 'geo-coords')?.status).toBe('pass');

    const invalid = analyzePayload(parseQRContent('geo:999,-500'));
    expect(byId(invalid, 'geo-coords')?.status).toBe('warn');
  });

  it('text: plain text passes, phishing wording warns', () => {
    const plain = analyzePayload(parseQRContent('just some words'));
    expect(byId(plain, 'text-plain')?.status).toBe('pass');

    const phishy = analyzePayload(parseQRContent('URGENT: verify your wallet seed now'));
    expect(byId(phishy, 'text-keywords')?.status).toBe('warn');
  });

  it('unknown types degrade to "can\'t assess", never safe-by-default', () => {
    const content: QRContent = { type: 'unknown', text: '???', raw: '???' };
    const analysis = analyzePayload(content);
    expect(byId(analysis, 'unknown-type')?.status).toBe('info');
    expect(analysis.recommendations.length).toBeGreaterThan(0);
  });
});
