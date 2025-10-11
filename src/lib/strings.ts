export const STRINGS = {
  hero: {
    title: 'QRCheck',
    tagline: 'Decode locally, expand redirects, and understand where a QR code really leads.'
  },
  camera: {
    ready: '📷 Camera ready',
    blocked: '🚫 Camera blocked – use upload instead.',
    ask: '🎯 Grant camera access to scan codes instantly.',
    openButton: 'Open camera',
    failure: 'Unable to access the camera.'
  },
  inputs: {
    destinationLabel: 'Destination URL',
    destinationPlaceholder: 'https://example.com',
    displayLabel: 'Display text (optional)',
    displayPlaceholder: 'Visible link text',
    analyzeButton: 'Analyze',
    analyzingButton: 'Analyzing…',
    recheckButton: 'Recheck (bypass cache)',
    emptyError: 'Enter a URL to analyze.',
    copyError: 'Could not copy the final URL.',
    analysisError: 'Analysis failed. Try again.'
  },
  verdict: {
    safe: {
      emoji: '✅',
      title: 'Safe',
      guidance: 'Local checks show no obvious risk indicators.'
    },
    warn: {
      emoji: '⚠️',
      title: 'Caution',
      guidance: 'Review the highlighted checks before you proceed.'
    },
    block: {
      emoji: '⛔️',
      title: 'High risk',
      guidance: 'Avoid entering credentials or downloading files from this link.'
    }
  },
  result: {
    banner: 'Could not fully expand. Scoring used available data.',
    riskLabel: 'Risk score',
    originalLabel: 'Original',
    expandedLabel: 'Expanded to',
    copyFinal: 'Copy final URL',
    linkPath: 'Link path',
    hopOriginal: 'Original',
    hopFinal: 'Final',
    collapseSummary: 'Hide reasons',
    expandSummary: 'Show reasons',
    displayMismatch: 'Display domain mismatch'
  },
  warnings: {
    expansionPrefix: 'Expansion incomplete'
  }
} as const;
