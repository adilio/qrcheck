# QRCheck Agent Handbook

This guide consolidates the previous `AGENTS.md`, `PLAN.md`, and `IMPLEMENTATION.md` references into a single playbook that autonomous contributors can follow end-to-end.

---

## Mission Snapshot

- **Goal**: Ship and maintain a privacy-first QR inspection toolkit that decodes locally, scores destinations with transparent heuristics, traces redirects, and optionally enriches results with a Go microservice.
- **Stack**: Svelte + TypeScript + Vite for the SPA, Go for the optional API, Playwright/Vitest for tests, GitHub Pages for hosting.
- **Design principles**: Static-first, private by default, transparent scoring, mobile-friendly, deterministic tests, and clear observability of any risk signals.

---

## UX & Architecture Priorities

- **Streamlined entry**: Replace competing CTAs with a single primary button that opens a modal/sheet for camera, upload, and paste options. The first-run experience should guide users directly into scanning without noise.
- **Progressive disclosure**: Default verdicts to a compact summary (e.g., "✅ Safe – Reputable destination") and tuck deeper checks, redirect history, and intel into expandable sections.
- **Actionable signals**: Keep verdict chip copy short and directive ("Avoid entering credentials"), moving longer explanations into a `Learn More` drawer.
- **Lightweight styling**: Retire heavy glassmorphism in favour of neutral surfaces, subtle elevation, and strong contrast for readability.
- **Robust empty/error states**: Surface permission and hardware failures via alert banners that include recovery steps.
- **Accessibility guardrails**: Honour focus-visible styles, ensure `aria-*` attributes map correctly, and avoid auto-focus on mount.
- **Onboarding helper**: Add a three-step guide or looping demo that highlights "Point camera → Check verdict → Share safely".

---

## Architecture Direction

- **Stay on Svelte + Vite**: The current static-first approach meets performance, privacy, and deployment goals. Keep the SPA portable and CDN-friendly.
- **Next.js stance**: Do not migrate today. Only reconsider if the roadmap demands authenticated accounts, personalised history, or dynamic marketing surfaces. When that moment arrives, evaluate SvelteKit first to preserve component investment.
- **Optional backend**: Continue treating the Go microservice as an add-on. The frontend must gracefully degrade when `VITE_API_BASE` is unset.

---

## Repository Layout

```
qrcheck/
  README.md
  src/
    App.svelte          ← primary UI flow
    app.css             ← global styling
    lib/                ← helpers (camera, decode, heuristics, API client, flags)
  public/               ← static assets (icons, manifest)
  mocks/
    api-mock.js         ← deterministic intel/resolve mock server
  tests/
    unit/               ← Vitest suites
    e2e/                ← Playwright specs
    fixtures/blank.png
  contracts/            ← JSON schemas validating backend payloads
  api/                  ← Go microservice (resolve + intel handlers)
  .github/workflows/    ← CI + Pages deploy pipelines
  docs/threat-intel.md  ← feed reference notes
```

---

## Frontend Quick Reference

| Concern | File(s) | Notes |
| --- | --- | --- |
| Feature flags | `src/lib/flags.ts` | Toggle manual URL input via `VITE_DEV_MANUAL_URL`. |
| Camera control | `src/lib/camera.ts` | Provides cross-browser `getUserMedia` helpers with legacy fallbacks. |
| QR decoding | `src/lib/decode.ts` | Uses `jsQR` over `ImageData` extracted from `<canvas>`. |
| Heuristics | `src/lib/heuristics.ts` | Normalises URLs, scores HTTPS, TLD, punycode, file downloads, length, shorteners, and dangerous schemes. |
| API client | `src/lib/api.ts` | Wraps optional Go API for redirect tracing (`resolve`) and intel lookups (`intel`). |
| UI shell | `src/App.svelte` | Handle camera capture, drag-and-drop, clipboard ingest, manual URLs, verdict display, and intel cards. |

Key interaction flow inside `App.svelte`:
1. **Reset state** (`reset`) and run **decode** using file/camera/clipboard/manual entry.
2. Apply **heuristics** locally for an immediate verdict.
3. Call **resolve** to trace redirects, followed by **intel** to enrich with feed data when the backend is configured.
4. Present expandable verdict chips so users can optionally dive into each heuristic explanation without cluttering the UI.

---

## Short URL Intelligence Pipeline

1. **Canonical provider list**
   - Fetch from [korlabsio/urlshortener](https://raw.githubusercontent.com/korlabsio/urlshortener/refs/heads/main/names.txt) and [PeterDaveHello/url-shorteners](https://raw.githubusercontent.com/PeterDaveHello/url-shorteners/refs/heads/master/list) using conditional requests (`If-None-Match`, `If-Modified-Since`).
   - Store merged domains in `public/shorteners.json` along with metadata in `data/sources.lock.json`.
   - Validate against `contracts/shorteners.schema.json` and fail CI if the schema or domain count regresses unexpectedly.
2. **Typed ingestion helper**
   - Implement `src/lib/shorteners.ts` with `loadShorteners()` that caches domains locally (IndexedDB or `localStorage`).
   - Update `src/lib/heuristics.ts` so `isLikelyShortUrl()` consults this dataset first before falling back to heuristics like length or rare TLDs.
3. **Optional enrichment API**
   - Introduce a `/shorteners` endpoint that serves the cached JSON with proper `Cache-Control` headers.
   - Allow `/resolve` to expand recognised short URLs server-side prior to scoring.
4. **Monitoring & alerting**
   - Log list size and freshness timestamp in diagnostics endpoints or telemetry.
   - Alert when refresh fails validation or the domain count drops sharply.
   - Document cadence updates in `docs/threat-intel.md`.
5. **Automation script**
   - Add `.github/scripts/refresh-shorteners.mjs` (see review snippet) and a scheduled workflow to refresh nightly.
   - Ensure the script respects `MAX_AGE_MS` caching, writes outputs, and validates via Ajv before committing changes.

---

## Backend Quick Reference

- Entry point: `api/cmd/qrcheck/main.go` (handlers for `/resolve`, `/intel`, `/health`).
- Rate limiting: `api/cmd/qrcheck/ratelimit.go` (60 requests/minute per IP).
- Tests: `api/cmd/qrcheck/main_test.go` (redirect helpers, rate limiter, PhishTank behaviour).
- Deployment: `api/Dockerfile`, `api/fly.toml`; environment variables include `CORS_ORIGIN`, `PHISHTANK_API_KEY`, optional Google Safe Browsing keys.

The Go service is optional. When `VITE_API_BASE` is unset, the frontend falls back to client-only analysis while intel cards surface "Not checked".

## CORS Bypass for Redirect Expansion

### The Problem
Browser security policies prevent cross-origin requests to shorteners like `tiny.cc`, `bit.ly`, etc. When scanning QR codes containing these URLs, the frontend cannot follow redirects to reveal the final destination, showing misleading "No redirects" messages.

### Solution: Deploy Go API for Server-Side Redirect Resolution

The Go microservice in `/api/` bypasses CORS by making server-side HTTP requests that aren't subject to browser restrictions. It follows redirects using HEAD/GET requests with browser-like User-Agent headers and returns the complete redirect chain.

### Free Deployment Options

1. **Railway** (Recommended)
   - Free tier: $5/month credit + community credit
   - Native Go support
   - CLI deployment: `railway login && railway init && railway up`
   - Sleeps after 30min inactivity, wakes on request

2. **Render**
   - Free tier: Web services with 15min sleep
   - GitHub integration for easy deployment
   - Native Go support

3. **Replit**
   - Free tier: Always-on for hobby projects
   - Go support available
   - Usage caps apply

### Deployment Steps (Railway Example)

```bash
# Install Railway CLI
npm install -g @railway/cli

# From the project root
cd api
railway login
railway init
railway up
```

### Configuration

1. Set `VITE_API_BASE` environment variable to your deployed API URL
2. Example: `VITE_API_BASE=https://your-app-name.up.railway.app`
3. Frontend will automatically use the API for redirect expansion when available
4. Falls back gracefully to client-side analysis with appropriate messaging

### Implementation Details

- The Go API uses `resolveChainLocally()` with HEAD/GET fallback strategy
- Browser User-Agent headers to avoid bot detection
- 10 redirect limit with loop detection
- Returns JSON with `hops` array and `final` URL
- Frontend displays enhanced redirect information when available

### Fallback Behavior

When API is unavailable or CORS blocks requests:
- Shows "⚠️ Redirects blocked - Browser security prevents expansion" for known shorteners
- Provides transparent messaging about limitations
- Maintains all other security analysis features

---

## Build & Test Commands

| Command | Description |
| --- | --- |
| `npm install` | Install frontend dependencies. |
| `npm run dev` | Launch Vite dev server (set `VITE_API_BASE` to point at the mock or real API). |
| `node mocks/api-mock.js` | Start deterministic mock intel server for local dev/tests. |
| `npm run build` | Create production bundle in `dist/` (used by GitHub Pages). |
| `npm run test` | Run Vitest unit suites. |
| `npm run e2e` | Execute Playwright specs; the config spins up mocks and Vite automatically. |
| `npm run ci:verify` | Type-check, lint, unit test, e2e test, and build sequentially. |
| `cd api && go test ./...` | Execute backend unit tests. |

---

## Coding & Quality Standards

- **TypeScript/Svelte**: 2-space indentation, strict typing, descriptive naming. Rely on Vitest + Playwright for safety nets.
- **Go**: Follow `go fmt`, prefer early returns, table-driven tests, and explicit context timeouts on outbound calls.
- **Security**: Keep all heuristics client-side, cap redirect chains at 10 HEAD requests, validate API payloads with JSON schemas, and surface clear errors to the UI.
- **Accessibility**: Buttons and interactive chips are keyboard friendly; ensure new UI work respects `focus-visible`, `aria` semantics, and mobile breakpoints.

---

## Testing Matrix

- **Unit**: Heuristics scoring, schema validation (`tests/unit`).
- **E2E**: Manual URL and failure states via Playwright (`tests/e2e`).
- **Backend**: Rate limiting, URL resolution, and intel fallbacks (`api/cmd/qrcheck/main_test.go`).
- Keep fixtures deterministic; extend the mock server and JSON schemas when behaviour changes.

---

## Implementation Roadmap

1. **Design pass**: Wireframe the simplified landing screen, verdict cards, and onboarding helper. Validate mobile breakpoints first.
2. **Component refactor**: Break `App.svelte` into modular components for the CTA modal, verdict summary, detailed drawers, and alert banners.
3. **State audit**: Introduce a finite-state machine that captures `idle`, `scanning`, `processing`, `error`, and `complete` to simplify transitions.
4. **Styling system**: Replace ad-hoc styles with CSS variables for colours, spacing, radius, and elevation tokens.
5. **Docs & help**: Update README/help text to match the streamlined flow and new vocabulary.
6. **Platform guardrails**: Revisit Next.js or SvelteKit only if authentication, dashboards, or dynamic content enter the roadmap.

---

## Quick Wins Checklist

- [ ] Replace hero CTA cluster with a unified entry button + modal.
- [ ] Collapse verdict details behind toggles.
- [ ] Shorten verdict chip copy and move deep explanations to a drawer.
- [ ] Add alert banners for error states and ensure focus-visible outlines.
- [ ] Introduce onboarding helper (3-step guide or demo loop).
- [ ] Ship the shortener refresh workflow, schema, and ingestion helper.

---

## CI & Deployment Notes

- **CI workflow (`.github/workflows/ci.yml`)**:
  - Installs dependencies, Playwright browsers, runs `npm run ci:verify`, and executes Go tests.
  - Playwright handles mock server + Vite lifecycle; no manual background processes required.
- **Pages workflow (`.github/workflows/pages.yml`)**:
  - Builds with Vite, uploads artefact via `upload-pages-artifact@v3`, and deploys to the `github-pages` environment.
- SPA assets assume the `/qrcheck/` base path when `GITHUB_ACTIONS` or `GITHUB_REPOSITORY` is present. Override with `QRCHECK_BASE` if deploying elsewhere.

---

## Agent Workflow

1. **Bootstrap**: `npm install`, optional `node mocks/api-mock.js`, `npm run dev`.
2. **Implement**: Touch the relevant modules (`src/lib/*`, `src/App.svelte`, `api/...`) with tight feedback loops.
3. **Validate**: Run `npm run ci:verify`; if backend changes were made, run `go test ./...`.
4. **Document**: Update this handbook or `README.md` when workflows or expectations change.
5. **Deploy**: Merge to `main` to trigger CI and GitHub Pages deployment; monitor the workflow run for regressions.

Maintain deterministic tests, prefer mocks/schemas over live services, and document any deviation from the plan so future agents can follow the trail.
