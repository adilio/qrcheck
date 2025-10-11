/**
 * Tests for the URL heuristics analysis module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeHeuristics, formatHeuristicResults } from '../../src/lib/heuristics';
import { checkUrlShortener } from '../../src/lib/shortener';
import type { QRContent } from '../../src/lib/decode';

// Mock the shortener module
vi.mock('../../src/lib/shortener');

const mockCheckUrlShortener = vi.mocked(checkUrlShortener);

describe('analyzeHeuristics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock for shortener check
    mockCheckUrlShortener.mockResolvedValue({
      isShortener: false,
      domain: null,
      matchedPattern: null,
      knownServices: []
    });
  });

  it('should return low risk for non-URL content', async () => {
    const content: QRContent = {
      type: 'text',
      text: 'This is just plain text',
      raw: 'This is just plain text'
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.risk).toBe('low');
    expect(result.score).toBe(0);
    expect(result.recommendations).toContain('Only URLs can be analyzed for heuristics');
  });

  it('should return low risk for safe URLs', async () => {
    const content: QRContent = {
      type: 'url',
      text: 'https://www.example.com/path/to/page',
      raw: 'https://www.example.com/path/to/page'
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.risk).toBe('low');
    expect(result.score).toBeLessThan(40);
    expect(result.details.shortenerCheck?.isShortener).toBe(false);
  });

  it('should detect URL shorteners and increase risk', async () => {
    mockCheckUrlShortener.mockResolvedValueOnce({
      isShortener: true,
      domain: 'bit.ly',
      matchedPattern: null,
      knownServices: ['bit.ly', 'tinyurl.com']
    });

    const content: QRContent = {
      type: 'url',
      text: 'https://bit.ly/abc123',
      raw: 'https://bit.ly/abc123'
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.details.shortenerCheck?.isShortener).toBe(true);
    expect(result.details.shortenerCheck?.domain).toBe('bit.ly');
    expect(result.recommendations).toContain('URL uses shortener service: bit.ly');
  });

  it('should detect excessively long URLs', async () => {
    const longUrl = 'https://www.example.com/' + 'a'.repeat(2000);
    
    const content: QRContent = {
      type: 'url',
      text: longUrl,
      raw: longUrl
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.details.urlLength?.isExcessive).toBe(true);
    expect(result.recommendations).toContain('URL is excessively long, which may indicate obfuscation');
  });

  it('should detect URL obfuscation', async () => {
    const obfuscatedUrl = 'https://www.example.com/path?param=%68%74%74%70%73%3A%2F%2F%77%77%77%2E%65%78%61%6D%70%6C%65%2E%63%6F%6D';
    
    const content: QRContent = {
      type: 'url',
      text: obfuscatedUrl,
      raw: obfuscatedUrl
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.details.obfuscation?.hasObfuscation).toBe(true);
    expect(result.recommendations).toContain(
      `URL contains obfuscation patterns: ${result.details.obfuscation?.patterns.join(', ')}`
    );
  });

  it('should detect suspicious keywords', async () => {
    const suspiciousUrl = 'https://www.example.com/login?redirect=secure-update';
    
    const content: QRContent = {
      type: 'url',
      text: suspiciousUrl,
      raw: suspiciousUrl
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.details.suspiciousKeywords?.hasKeywords).toBe(true);
    expect(result.details.suspiciousKeywords?.matches).toContain('login');
    expect(result.recommendations).toContain(
      `URL contains suspicious keywords: ${result.details.suspiciousKeywords?.matches.join(', ')}`
    );
  });

  it('should detect IP-based URLs', async () => {
    const ipUrl = 'https://192.168.1.1/login';
    
    const content: QRContent = {
      type: 'url',
      text: ipUrl,
      raw: ipUrl
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.score).toBeGreaterThanOrEqual(35);
    expect(result.details.domainReputation?.isIPBased).toBe(true);
    expect(result.recommendations).toContain('URL uses IP address instead of domain name');
  });

  it('should detect suspicious TLDs', async () => {
    const suspiciousTldUrl = 'https://example.tk/login';
    
    const content: QRContent = {
      type: 'url',
      text: suspiciousTldUrl,
      raw: suspiciousTldUrl
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.details.domainReputation?.hasSuspiciousTLD).toBe(true);
    expect(result.recommendations).toContain('Domain uses suspicious top-level domain');
  });

  it('should assign high risk for URLs with multiple issues', async () => {
    mockCheckUrlShortener.mockResolvedValueOnce({
      isShortener: true,
      domain: 'bit.ly',
      matchedPattern: null,
      knownServices: ['bit.ly', 'tinyurl.com']
    });

    const content: QRContent = {
      type: 'url',
      text: 'https://bit.ly/abc123?redirect=secure-login',
      raw: 'https://bit.ly/abc123?redirect=secure-login'
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.risk).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.recommendations).toContain('High risk: Exercise extreme caution with this URL');
  });

  it('should assign medium risk for URLs with some issues', async () => {
    const content: QRContent = {
      type: 'url',
      text: 'https://example.com/login',
      raw: 'https://example.com/login'
    };

    const result = await analyzeHeuristics(content);
    
    // The score should be at least 25 for suspicious keywords
    expect(result.score).toBeGreaterThanOrEqual(25);
    // Since the score is 40 or more, the risk should be 'medium'
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.risk).toBe('medium');
    expect(result.recommendations).toContain('Medium risk: Verify the legitimacy of this URL before proceeding');
  });

  it('should handle errors gracefully', async () => {
    mockCheckUrlShortener.mockRejectedValueOnce(new Error('Network error'));
    
    const content: QRContent = {
      type: 'url',
      text: 'https://bit.ly/abc123',
      raw: 'https://bit.ly/abc123'
    };

    const result = await analyzeHeuristics(content);
    
    expect(result.risk).toBe('low');
    expect(result.score).toBe(0);
  });
});

describe('formatHeuristicResults', () => {
  it('should format low risk results correctly', () => {
    const result = {
      risk: 'low' as const,
      score: 10,
      details: {
        shortenerCheck: {
          isShortener: false,
          domain: null,
          matchedPattern: null,
          knownServices: []
        }
      },
      recommendations: ['Low risk: URL appears to be safe, but always exercise caution']
    };

    const formatted = formatHeuristicResults(result);
    
    expect(formatted.riskColor).toBe('#22c55e');
    expect(formatted.riskText).toBe('Low Risk');
    expect(formatted.summary).toBe('Risk Score: 10/100');
    expect(formatted.details).toEqual([]);
  });

  it('should format medium risk results correctly', () => {
    const result = {
      risk: 'medium' as const,
      score: 50,
      details: {
        shortenerCheck: {
          isShortener: true,
          domain: 'bit.ly',
          matchedPattern: null,
          knownServices: ['bit.ly']
        },
        suspiciousKeywords: {
          hasKeywords: true,
          matches: ['login']
        }
      },
      recommendations: ['Medium risk: Verify the legitimacy of this URL before proceeding']
    };

    const formatted = formatHeuristicResults(result);
    
    expect(formatted.riskColor).toBe('#f59e0b');
    expect(formatted.riskText).toBe('Medium Risk');
    expect(formatted.summary).toBe('Risk Score: 50/100');
    expect(formatted.details).toContain('Uses URL shortener: bit.ly');
    expect(formatted.details).toContain('Suspicious keywords: login');
  });

  it('should format high risk results correctly', () => {
    const result = {
      risk: 'high' as const,
      score: 85,
      details: {
        shortenerCheck: {
          isShortener: true,
          domain: 'bit.ly',
          matchedPattern: null,
          knownServices: ['bit.ly']
        },
        urlLength: {
          value: 2500,
          threshold: 2000,
          isExcessive: true
        },
        obfuscation: {
          hasObfuscation: true,
          patterns: ['excessive URL encoding']
        },
        domainReputation: {
          isNewDomain: true,
          hasSuspiciousTLD: true,
          isIPBased: false
        }
      },
      recommendations: ['High risk: Exercise extreme caution with this URL']
    };

    const formatted = formatHeuristicResults(result);
    
    expect(formatted.riskColor).toBe('#ef4444');
    expect(formatted.riskText).toBe('High Risk');
    expect(formatted.summary).toBe('Risk Score: 85/100');
    expect(formatted.details).toContain('Uses URL shortener: bit.ly');
    expect(formatted.details).toContain('Excessively long URL (2500 characters)');
    expect(formatted.details).toContain('Contains obfuscation: excessive URL encoding');
    expect(formatted.details).toContain('Newly registered domain');
    expect(formatted.details).toContain('Uses suspicious top-level domain');
  });
});