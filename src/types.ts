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
