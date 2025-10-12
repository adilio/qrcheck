export const SUSPICIOUS_TLDS = [
  '.zip',
  '.mov',
  '.xyz',
  '.top',
  '.click',
  '.country',
  '.link',
  '.gq',
  '.cf',
  '.tk',
  '.work',
  '.support',
  '.email',
  '.rest',
  '.mom',
  '.kim',
  '.surf',
  '.lol',
  '.quest',
  '.party',
  '.monster',
  '.icu',
  '.best',
  '.biz',
  '.win'
] as const satisfies readonly string[];

export type SuspiciousTld = (typeof SUSPICIOUS_TLDS)[number];

const suspiciousTldSet: ReadonlySet<string> = new Set(SUSPICIOUS_TLDS);

export function isSuspiciousTld(tld: string): tld is SuspiciousTld {
  return suspiciousTldSet.has(tld);
}
