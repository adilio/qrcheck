# QRcheck.ca

QRCheck.ca is a privacy-first QR inspection toolkit. It decodes QR codes locally in your browser, scores destinations with transparent heuristics, traces redirects, and surfaces live intelligence signals from optional backend feeds. The UI draws from a liquid-glass aesthetic, supports dark/light themes, and works across desktop and mobile—including live camera scanning.

## ✨ Highlights
- **Static-first SPA** built with Svelte + Vite, deployable to GitHub Pages or any static host.
- **Fast decoding** from file uploads, clipboard paste, drag-and-drop, or live camera capture.
- **Transparent scoring** with weighted heuristics (HTTPS, TLD, punycode, length, shorteners, scheme, file downloads) and emoji-rich verdicts.
- **Redirect intelligence** and feed integrations via an optional Go microservice (URLHaus, PhishTank, room for more).
- **Autonomous testing**: Vitest unit suites, JSON schema contract tests, Playwright end-to-end with mocked intel.

## 🧱 Project Layout
```
qrcheck/
  README.md            ← You are here
  src/                 ← Svelte SPA (App, heuristics, decode, API helpers)
  public/              ← Static assets (manifest, icons)
  mocks/api-mock.js    ← Deterministic intel/resolve mock server
  tests/               ← Vitest unit + Playwright E2E + fixtures
  contracts/           ← JSON schemas for backend responses
  api/                 ← Go HTTP API (resolve + intel handlers)
  .github/workflows/   ← CI and Pages deploy pipelines
```

## 🚀 Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Run the mock API** (new terminal):
   ```bash
   node mocks/api-mock.js
   ```
   - Provide `MOCK_HTTPS_CERT`/`MOCK_HTTPS_KEY` (and optional `MOCK_PORT`) when you need HTTPS for mobile camera testing.
3. **Launch the dev server**:
   ```bash
   VITE_API_BASE=http://localhost:9090 VITE_DEV_MANUAL_URL=true npm run dev
   ```
   - Use `--host` to expose on your LAN. Add `--https --cert <path> --key <path>` to unlock camera on mobile browsers.
4. **Visit** `http://localhost:5173` (or your chosen host). Toggle dark/light mode via the header button.

## 📷 Using the App
- **Upload**: click “Browse files” or drag & drop a QR image onto the drop zone.
- **Clipboard**: press the clipboard button or paste directly (supports images & URLs).
- **Camera**: tap “Open camera” (requires HTTPS); the scan auto-stops when a code is detected.
- **Manual URL**: enable `VITE_DEV_MANUAL_URL=true` to unlock the testing input during development.

Each decode runs locally before contacting the API. The verdict card shows:
- Weighted score with explanatory chips.
- Redirect trail (HEAD requests, loop-protected).
- Intel cards for feeds (URLHaus, PhishTank). Feeds return “Not checked” when the backend is disabled.

## 🧪 Testing & Tooling
- **Unit + contract tests**: `npm run test`
- **Playwright E2E** (with mock servers): `npm run e2e`
- **Full CI parity**: `npm run ci:verify`
- **Go backend tests**: `cd api && go test ./...`

Playwright config starts the mock API and Vite server automatically. Tests stay deterministic by stubbing network intel responses.

## 🛠 Backend (Optional)
The Go API (in `api/`) provides two endpoints:
- `GET /resolve?url=` — Traces redirects with HEAD requests (10-hop limit, loop detection, custom UA).
- `POST /intel` — Proxy to URLHaus + PhishTank with caching directives and error shielding.

Deployment helpers:
- `api/Dockerfile` and `api/fly.toml` for Fly.io.
- Configure environment variables (`CORS_ORIGIN`, `PHISHTANK_API_KEY`, optional `GSB_API_KEY`).

## 📦 Production Build & Deploy
- **Build SPA**: `npm run build` (emits `dist/` with `.nojekyll`).
- **GitHub Pages**: see `.github/workflows/pages.yml`.
- **CI checks**: `.github/workflows/ci.yml` runs lint, unit, e2e, build, plus Go tests.

## 🔐 Privacy & Security Notes
- All QR decoding and heuristics execute client-side before any network calls.
- Redirect tracing uses HEAD with 10-hop cap, 10s timeout, and loop detection.
- API responses are validated with JSON schemas; errors surface in the UI with clear messaging.
- Camera access requires HTTPS; use self-signed certs locally (`mkcert` works well) and run both SPA and mock/API over TLS for mobile testing.

## 🤝 Contributing
- Follow the guidelines in `AGENTS.md` for structure, commands, linting, and testing expectations.
- Keep tests deterministic—extend mocks and schemas when touching intel/resolve behaviour.
- Prefer descriptive PRs with screenshots or terminal snippets of new flows.

## 📄 License
MIT © 2025 Present Collaborators. See [`LICENSE`](./LICENSE).

Enjoy safer QR scanning! ✨
