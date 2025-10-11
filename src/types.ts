export interface RedirectExpansion {
  chain: string[];
  finalUrl: string;
  hops: number;
  reason?: ExpansionFailureReason;
}

export type ExpansionFailureReason =
  | 'network_error'
  | 'too_many_redirects'
  | 'redirect_loop'
  | 'unsupported_scheme'
  | 'timeout';

export interface UrlSignals {
  is_https: boolean;
  suspicious_tld: boolean;
  punycode: boolean;
  executable_mime: boolean;
  very_long: boolean;
  shortener: 'known' | 'unknown' | 'none';
  redirect_hops: number;
  domain_age_days: number | null;
  suspicious_keywords: string[];
  dangerous_scheme: boolean;
  archive_download: boolean;
}

export type Verdict = 'safe' | 'warn' | 'block';

export interface UrlAnalysisResult {
  original_url: string;
  redirect_chain: string[];
  final_url: string;
  signals: UrlSignals;
  score: number;
  verdict: Verdict;
  reasons: string[];
  warnings: string[];
  display_label_mismatch?: boolean;
  expansion_failure?: ExpansionFailureReason;
}

export interface UrlAnalysisOptions {
  displayUrl?: string;
  bypassCache?: boolean;
  labelHost?: string;
}
