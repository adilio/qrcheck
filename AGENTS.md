# QRCheck Agent Handbook

This guide consolidates the previous `AGENTS.md`, `PLAN.md`, and `IMPLEMENTATION.md` references into a single playbook that autonomous contributors can follow end-to-end.

---

## Mission Snapshot

- **Goal**: Ship and maintain a privacy-first QR inspection toolkit that decodes locally, scores destinations with transparent heuristics, traces redirects, and optionally enriches results with a Go microservice.
- **Stack**: Svelte + TypeScript + Vite for the SPA, Go for the optional API, Playwright/Vitest for tests, GitHub Pages for hosting.
- **Design principles**: Static-first, private by default, transparent scoring, mobile-friendly, deterministic tests, and clear observability of any risk signals.

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
| UI shell | `src/App.svelte` | Handles camera capture, drag-and-drop, clipboard ingest, manual URLs, verdict display, and intel cards. |

Key interaction flow inside `App.svelte`:
1. **Reset state** (`reset`) and run **decode** using file/camera/clipboard/manual entry.
2. Apply **heuristics** locally for an immediate verdict.
3. Call **resolve** to trace redirects, followed by **intel** to enrich with feed data when the backend is configured.
4. Present expandable verdict chips so users can optionally dive into each heuristic explanation without cluttering the UI.

---

## Backend Quick Reference

- Entry point: `api/cmd/qrcheck/main.go` (handlers for `/resolve`, `/intel`, `/health`).
- Rate limiting: `api/cmd/qrcheck/ratelimit.go` (60 requests/minute per IP).
- Tests: `api/cmd/qrcheck/main_test.go` (redirect helpers, rate limiter, PhishTank behaviour).
- Deployment: `api/Dockerfile`, `api/fly.toml`; environment variables include `CORS_ORIGIN`, `PHISHTANK_API_KEY`, optional Google Safe Browsing keys.

The Go service is optional. When `VITE_API_BASE` is unset, the frontend falls back to client-only analysis while intel cards surface “Not checked”.

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
