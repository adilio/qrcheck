/**
 * URL Heuristics Types & Formatting
 *
 * The live URL analysis now lives in `heuristics-tiered.ts`. This module retains
 * the shared `HeuristicResult` shape it produces plus `formatHeuristicResults`,
 * which turns that shape into the display model the UI renders.
 */

import type { ShortenerCheckResult } from './shortener';

export interface HeuristicResult {
  risk: 'low' | 'medium' | 'high';
  score: number; // 0-100, higher is more risky
  details: {
    shortenerCheck?: ShortenerCheckResult;
    urlLength?: {
      value: number;
      threshold: number;
      isExcessive: boolean;
    };
    obfuscation?: {
      hasObfuscation: boolean;
      patterns: string[];
    };
    suspiciousKeywords?: {
      hasKeywords: boolean;
      matches: string[];
    };
    domainReputation?: {
      isNewDomain: boolean;
      hasSuspiciousTLD: boolean;
      isIPBased: boolean;
    };
    threatIntel?: {
      urlhausMatches: number;
      isMalicious: boolean;
    };
    typosquatting?: {
      isTyposquat: boolean;
      detectedBrand: string;
      distance: number;
    };
    homographs?: {
      hasHomographs: boolean;
      characters: Array<{fake: string, real: string}>;
    };
    enhancedKeywords?: {
      hasKeywords: boolean;
      matches: Array<{category: string, word: string}>;
    };
    domainAge?: {
      age_days: number | null;
      risk_points: number;
      message: string;
    };
    enhancedThreatIntel?: {
      threat_detected: boolean;
      risk_points: number;
      message: string;
      threats: Array<{ source: string; details: string; score: number }>;
      sources_checked: string[];
    };
  };
  recommendations: string[];
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface FormattedHeuristicIssue {
  id: string;
  label: string;
  severity: 'warn' | 'fail';
  detail?: string;
}

export interface FormattedHeuristicCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface FormattedIntelSource {
  name: string;
  status: 'clean' | 'warn' | 'block' | 'error';
  headline: string;
  detail: string;
}

export interface FormattedHeuristicSummary {
  riskColor: string;
  riskText: string;
  summary: string;
  issues: FormattedHeuristicIssue[];
  checks: FormattedHeuristicCheck[];
  intelSources: FormattedIntelSource[];
}

/**
 * Formats heuristic results for display
 */
export function formatHeuristicResults(result: HeuristicResult): FormattedHeuristicSummary {
  let riskColor = '#22c55e';
  let riskText = 'Low Risk';

  if (result.risk === 'medium') {
    riskColor = '#f59e0b';
    riskText = 'Medium Risk';
  } else if (result.risk === 'high') {
    riskColor = '#ef4444';
    riskText = 'High Risk';
  }

  const statusOrder: Record<CheckStatus, number> = { pass: 0, info: 1, warn: 2, fail: 3 };
  const intelStatusOrder: Record<FormattedIntelSource['status'], number> = {
    clean: 0,
    warn: 1,
    block: 2,
    error: 3
  };

  const checks: FormattedHeuristicCheck[] = [];
  const issueMap = new Map<string, FormattedHeuristicIssue>();
  const intelSourcesMap = new Map<string, FormattedIntelSource>();

  const addIssue = (issue: FormattedHeuristicIssue) => {
    const existing = issueMap.get(issue.id);
    if (!existing) {
      issueMap.set(issue.id, issue);
      return;
    }

    if (existing.severity === 'warn' && issue.severity === 'fail') {
      issueMap.set(issue.id, issue);
      return;
    }

    if (issue.detail && issue.detail !== existing.detail) {
      const combinedDetail = existing.detail
        ? `${existing.detail} • ${issue.detail}`
        : issue.detail;
      issueMap.set(issue.id, { ...existing, detail: combinedDetail });
    }
  };

  const upsertIntelSource = (source: FormattedIntelSource) => {
    const existing = intelSourcesMap.get(source.name);
    if (!existing) {
      intelSourcesMap.set(source.name, source);
      return;
    }

    const existingWeight = intelStatusOrder[existing.status];
    const incomingWeight = intelStatusOrder[source.status];

    if (incomingWeight > existingWeight) {
      intelSourcesMap.set(source.name, source);
      return;
    }

    if (incomingWeight === existingWeight && source.detail && source.detail !== existing.detail) {
      intelSourcesMap.set(source.name, {
        ...existing,
        detail: `${existing.detail} • ${source.detail}`
      });
    }
  };

  const shortenerCheck = result.details.shortenerCheck;
  if (shortenerCheck) {
    const isShortener = Boolean(shortenerCheck.isShortener);
    const domain = shortenerCheck.domain || 'shortener';
    const detail = isShortener ? `Uses ${domain}` : 'No shortener detected';
    checks.push({
      id: 'shortener',
      label: 'Short URL',
      status: isShortener ? 'warn' : 'pass',
      detail
    });

    if (isShortener) {
      addIssue({
        id: 'shortener',
        label: 'Shortened link detected',
        severity: 'warn',
        detail
      });
    }
  }

  let structureStatus: CheckStatus = 'pass';
  const structureDetails: string[] = [];

  if (result.details.urlLength?.isExcessive) {
    structureStatus = 'warn';
    structureDetails.push(`Very long (${result.details.urlLength.value} characters)`);
  }

  if (result.details.obfuscation?.hasObfuscation && result.details.obfuscation.patterns.length > 0) {
    structureStatus = 'fail';
    structureDetails.push(`Obfuscation: ${result.details.obfuscation.patterns.join(', ')}`);
  }

  const structureDetail = structureDetails.length
    ? structureDetails.join(' • ')
    : 'No structural issues detected';

  checks.push({
    id: 'structure',
    label: 'URL structure',
    status: structureStatus,
    detail: structureDetail
  });

  if (structureStatus !== 'pass') {
    addIssue({
      id: 'structure',
      label: structureStatus === 'fail' ? 'Dangerous URL structure' : 'Suspicious URL structure',
      severity: structureStatus === 'fail' ? 'fail' : 'warn',
      detail: structureDetail
    });
  }

  let keywordsStatus: CheckStatus = 'pass';
  const keywordDetails: string[] = [];

  if (result.details.suspiciousKeywords?.hasKeywords) {
    keywordsStatus = 'warn';
    keywordDetails.push(`Common phishing terms: ${result.details.suspiciousKeywords.matches.join(', ')}`);
  }

  if (result.details.enhancedKeywords?.hasKeywords) {
    keywordsStatus = 'fail';
    keywordDetails.push(
      `High-risk terms: ${result.details.enhancedKeywords.matches.map((m) => m.word).join(', ')}`
    );
  }

  const keywordsDetail = keywordDetails.length
    ? keywordDetails.join(' • ')
    : 'No suspicious words detected';

  checks.push({
    id: 'keywords',
    label: 'Keywords',
    status: keywordsStatus,
    detail: keywordsDetail
  });

  if (keywordsStatus !== 'pass') {
    addIssue({
      id: 'keywords',
      label: 'Suspicious wording detected',
      severity: keywordsStatus === 'fail' ? 'fail' : 'warn',
      detail: keywordsDetail
    });
  }

  let domainStatus: CheckStatus = 'pass';
  const domainDetails: string[] = [];

  if (result.details.domainReputation?.isNewDomain) {
    domainStatus = 'warn';
    domainDetails.push('Recently registered domain');
  }

  if (result.details.domainReputation?.hasSuspiciousTLD) {
    domainStatus = statusOrder[domainStatus] < statusOrder['warn'] ? 'warn' : domainStatus;
    domainDetails.push('Suspicious top-level domain');
  }

  if (result.details.domainReputation?.isIPBased) {
    domainStatus = 'fail';
    domainDetails.push('Uses IP address instead of domain name');
  }

  if (result.details.domainAge?.risk_points && result.details.domainAge.risk_points > 0) {
    domainStatus = statusOrder[domainStatus] < statusOrder['warn'] ? 'warn' : domainStatus;
    domainDetails.push(result.details.domainAge.message);
  }

  const domainDetail = domainDetails.length
    ? domainDetails.join(' • ')
    : 'Domain reputation looks normal';

  checks.push({
    id: 'domain',
    label: 'Domain reputation',
    status: domainStatus,
    detail: domainDetail
  });

  if (domainStatus !== 'pass') {
    addIssue({
      id: 'domain',
      label: domainStatus === 'fail' ? 'Dangerous domain profile' : 'Suspicious domain profile',
      severity: domainStatus === 'fail' ? 'fail' : 'warn',
      detail: domainDetail
    });
  }

  const typosquat = result.details.typosquatting;
  if (typosquat) {
    const typoStatus: CheckStatus = typosquat.isTyposquat ? 'fail' : 'pass';
    const typoDetail = typosquat.isTyposquat
      ? `Impersonates ${typosquat.detectedBrand}`
      : 'No brand impersonation detected';

    checks.push({
      id: 'typosquat',
      label: 'Brand look-alike',
      status: typoStatus,
      detail: typoDetail
    });

    if (typoStatus === 'fail') {
      addIssue({
        id: 'typosquat',
        label: 'Potential brand impersonation',
        severity: 'fail',
        detail: typoDetail
      });
    }
  }

  const homographs = result.details.homographs;
  if (homographs) {
    const homographStatus: CheckStatus = homographs.hasHomographs ? 'fail' : 'pass';
    const charList = Array.isArray(homographs.characters)
      ? homographs.characters.map((c) => c.fake).filter(Boolean).join(', ')
      : '';
    const homographDetail = homographs.hasHomographs && charList
      ? `Look-alike characters detected: ${charList}`
      : 'No Unicode look-alike characters detected';

    checks.push({
      id: 'homograph',
      label: 'Look-alike characters',
      status: homographStatus,
      detail: homographDetail
    });

    if (homographStatus === 'fail') {
      addIssue({
        id: 'homograph',
        label: 'Homograph attack detected',
        severity: 'fail',
        detail: homographDetail
      });
    }
  }

  let threatStatus: CheckStatus = 'pass';
  const threatDetails: string[] = [];

  const urlhaus = result.details.threatIntel;
  if (urlhaus) {
    if (urlhaus.isMalicious) {
      threatStatus = 'fail';
      const matchDetail = `URLHaus reported ${urlhaus.urlhausMatches} match${urlhaus.urlhausMatches === 1 ? '' : 'es'}`;
      threatDetails.push(matchDetail);
      upsertIntelSource({
        name: 'URLHaus',
        status: 'block',
        headline: `Reported malicious (${urlhaus.urlhausMatches} match${urlhaus.urlhausMatches === 1 ? '' : 'es'})`,
        detail: 'This URL is flagged as malicious by URLHaus.'
      });
    } else {
      upsertIntelSource({
        name: 'URLHaus',
        status: 'clean',
        headline: 'No listings found',
        detail: 'This URL is not currently flagged by URLHaus.'
      });
    }
  }

  const enhancedIntel = result.details.enhancedThreatIntel;
  if (enhancedIntel) {
    const threatMap = new Map<string, { source: string; details: string; score: number }>();
    enhancedIntel.threats.forEach((threat) => {
      if (threat && threat.source) {
        threatMap.set(threat.source, threat);
      }
    });

    if (enhancedIntel.sources_checked.length > 0) {
      enhancedIntel.sources_checked.forEach((sourceName) => {
        const threat = threatMap.get(sourceName);
        if (threat) {
          threatStatus = 'fail';
          const detail = `${sourceName} reported: ${threat.details}`;
          threatDetails.push(detail);
          upsertIntelSource({
            name: sourceName,
            status: 'block',
            headline: 'Reported malicious',
            detail: threat.details
          });
        } else {
          upsertIntelSource({
            name: sourceName,
            status: 'clean',
            headline: 'No issues found',
            detail: 'No threats reported by this provider.'
          });
        }
      });
    } else if (enhancedIntel.threats.length > 0) {
      enhancedIntel.threats.forEach((threat) => {
        threatStatus = 'fail';
        const detail = `${threat.source} reported: ${threat.details}`;
        threatDetails.push(detail);
        upsertIntelSource({
          name: threat.source,
          status: 'block',
          headline: 'Reported malicious',
          detail: threat.details
        });
      });
    } else if (enhancedIntel.message === 'Threat intelligence check failed') {
      threatStatus = statusOrder[threatStatus] < statusOrder['warn'] ? 'warn' : threatStatus;
      threatDetails.push('Threat intelligence checks could not be completed');
      upsertIntelSource({
        name: 'Threat intelligence',
        status: 'error',
        headline: 'Lookup failed',
        detail: 'Unable to reach threat intelligence services.'
      });
    }

    if (enhancedIntel.threat_detected && enhancedIntel.message) {
      threatDetails.push(enhancedIntel.message);
    }
  }

  if (threatDetails.length === 0) {
    threatDetails.push('No third-party providers reported threats.');
  }

  const threatDetail = threatDetails.join(' • ');

  checks.push({
    id: 'threat-intel',
    label: 'Threat intelligence',
    status: threatStatus,
    detail: threatDetail
  });

  if (threatStatus === 'fail') {
    addIssue({
      id: 'threat-intel',
      label: 'Threat intelligence providers flagged this URL',
      severity: 'fail',
      detail: threatDetail
    });
  } else if (threatStatus === 'warn') {
    addIssue({
      id: 'threat-intel',
      label: 'Threat intelligence incomplete',
      severity: 'warn',
      detail: threatDetail
    });
  }

  const severityOrder: Record<FormattedHeuristicIssue['severity'], number> = { warn: 1, fail: 2 };
  const issues = Array.from(issueMap.values()).sort(
    (a, b) => severityOrder[b.severity] - severityOrder[a.severity]
  );

  const intelSources = Array.from(intelSourcesMap.values()).sort(
    (a, b) => intelStatusOrder[b.status] - intelStatusOrder[a.status]
  );

  return {
    riskColor,
    riskText,
    summary: `Risk score: ${result.score}/100`,
    issues,
    checks,
    intelSources
  };
}
