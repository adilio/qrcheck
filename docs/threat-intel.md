# Threat Intel Documentation

## Current Threat Intelligence Providers

### Primary Feeds
- **URLVoid**: Free HTML scraping API; checks for security detections. Always queried first with 40-point scoring.
- **Google Safe Browsing**: Real-time threat detection with 40-point scoring.
  - Environment Variable: `GSB_API_KEY` (required for full functionality)
  - Fallback: Pattern analysis with 20-point scoring when no API key
  - Endpoint: `https://safebrowsing.googleapis.com/v4/threatMatches:find`
  - Client ID: `qrcheck` version `1.0.0`

### Legacy Feeds (Removed)
- ~~PhishTank~~: Previously used but no longer maintained
- ~~Phish.report~~: Requires paid subscription, removed to maintain free functionality

### Risk Scoring
- **URLVoid**: 40 points per detection
- **Google Safe Browsing**: 40 points (API) or 20 points (pattern fallback)
- **Risk Tiers**: High ≥ 80, Moderate ≥ 40, Low > 0

### Infrastructure
- **Netlify Function**: `/functions/check-threat-intel.ts`
- **Timeouts**: 6 seconds per API call
- **Response Format**: JSON with threat_detected, risk_points, message, threats array, sources_checked
- **Error Handling**: Graceful degradation with warning logs

## URLHaus Integration (Separate)
- **Feed**: Free feed; POST to `https://urlhaus.abuse.ch/api/v1/url/` with `url` form value
- **Local Cache**: `public/urlhaus/hosts.json` updated nightly at 2:23 AM UTC via GitHub Action
- **Live API**: Netlify Function at `/api/intel/urlhaus` with 4.5s timeout and CDN caching

## Best Practices
- Keep outbound calls behind 6-second timeouts
- Avoid storing raw URLs in logs
- Use structured logging with warning levels for API failures
- Monitor function execution time (target < 9 seconds total)
- Graceful degradation when APIs are unavailable

## Environment Variables Required
```
GSB_API_KEY=your_google_safe_browsing_key (optional for fallback)
```

## Monitoring Considerations
- Track API response times and error rates
- Monitor threat detection coverage by provider
- Log aggregate metrics only (anonymized)
- Alert on function timeouts or failures
