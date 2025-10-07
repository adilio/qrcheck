# Threat Intel Notes

- **URLHaus**: Free feed; POST to `https://urlhaus-api.abuse.ch/v1/url/` with `url` form value. Inspect `query_status` and cache `no_results` responses for 24h.
- **PhishTank**: Requires API key; POST to `https://checkurl.phishtank.com/checkurl/` with `url`, `app_key`, `format=json`. Handle 403/429 gracefully and surface error payloads to clients.
- **Google Safe Browsing (optional)**: Version 4 Lookup API, key-based; suitable for future phases if commercial coverage needed.
- Keep outbound calls behind 5–10 s timeouts and avoid storing raw URLs. Log aggregate metrics only if anonymized.
