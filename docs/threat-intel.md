# Threat Intel Notes

- **URLHaus**: Free feed; POST to `https://urlhaus.abuse.ch/api/v1/url/` with `url` form value. Inspect `query_status` and cache responses. Implemented with local host cache and live lookups.
- **Local Cache**: `public/urlhaus/hosts.json` updated nightly at 2:23 AM UTC via GitHub Action.
- **Live API**: Netlify Function at `/api/intel/urlhaus` with 4.5s timeout and CDN caching.
- **Google Safe Browsing (optional)**: Version 4 Lookup API, key-based; suitable for future phases if commercial coverage needed.
- Keep outbound calls behind 5–10 s timeouts and avoid storing raw URLs. Log aggregate metrics only if anonymized.
