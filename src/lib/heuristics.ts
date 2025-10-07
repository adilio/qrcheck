import { toUnicode } from 'punycode';

const BAD_TLDS = ['zip', 'mov', 'gq', 'tk', 'ml', 'cf', 'ru'];

export function normalizeURL(url: string): string {
  const u = new URL(url);
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }
  return u.toString();
}

export interface Signal {
  key: string;
  ok: boolean;
  info?: string;
}

export interface AnalysisResult {
  verdict: 'SAFE' | 'WARN' | 'BLOCK';
  score: number;
  normalized: string;
  signals: Signal[];
}

export function analyze(urlStr: string): AnalysisResult {
  try {
    const u = new URL(urlStr);
    const httpsBad = u.protocol !== 'https:';
    const badTld = BAD_TLDS.includes((u.hostname.split('.').pop() || '').toLowerCase());
    const puny = u.hostname.includes('xn--');
    const file = /\.(apk|exe|msi|pkg|dmg|zip|gz|rar)(\?|$)/i.test(u.pathname);
    const veryLong = urlStr.length > 180;
    const shortener = /(^|\.)(t\.co|bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|buff\.ly|lnkd\.in)$/i.test(u.hostname);
    const dataScheme = u.protocol === 'data:' || u.protocol === 'file:';

    const score =
      (httpsBad ? 15 : 0) +
      (badTld ? 20 : 0) +
      (puny ? 10 : 0) +
      (file ? 20 : 0) +
      (veryLong ? 5 : 0) +
      (shortener ? 6 : 0) +
      (dataScheme ? 50 : 0);

    const verdict: AnalysisResult['verdict'] = score >= 50 ? 'BLOCK' : score >= 20 ? 'WARN' : 'SAFE';
    return {
      verdict,
      score,
      normalized: normalizeURL(u.href),
      signals: [
        { key: 'https', ok: !httpsBad, info: httpsBad ? 'Not HTTPS' : '' },
        { key: 'suspicious_tld', ok: !badTld, info: badTld ? `.${(u.hostname.split('.').pop() || '').toLowerCase()}` : '' },
        { key: 'punycode', ok: !puny, info: puny ? toUnicode(u.hostname) : '' },
        { key: 'file_download', ok: !file },
        { key: 'very_long', ok: !veryLong },
        { key: 'shortener', ok: !shortener },
        { key: 'scheme_safe', ok: !dataScheme, info: dataScheme ? u.protocol : '' }
      ]
    };
  } catch {
    return {
      verdict: 'BLOCK',
      score: 80,
      normalized: urlStr,
      signals: [{ key: 'invalid_url', ok: false }]
    };
  }
}
