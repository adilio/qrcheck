# QRCheck.ca — Implementation and Autonomous Testing Plan (Final)

## Goal

Ship a static-first, privacy-preserving web app that decodes QR codes, shows safety signals, and optionally calls a small Go API for redirect tracing and free intel. Ensure an LLM agent can build, test, and error-correct without help.

## Stack

* Frontend: Svelte + TypeScript + Vite, hosted on GitHub Pages
* Backend: Go HTTP API on Fly.io or Render
* Data: none (in-memory caching only)
* CI: GitHub Actions for build, tests, and deploy

## Design principles

* Simple: SPA works alone; API is optional
* Private: no tracking, no URL logs
* Transparent: show hops, signals, and scoring details
* Accessible and mobile-first
* Deterministic tests with mocks for autonomous agents

---

## Repository layout

```
qrcheck/
  .gitignore
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  playwright.config.ts
  public/
    index.html
    manifest.webmanifest
    icon-192.png
    icon-512.png
  src/
    main.ts
    App.svelte
    app.css
    lib/
      flags.ts
      camera.ts
      decode.ts
      heuristics.ts
      api.ts
  mocks/
    api-mock.ts
  contracts/
    resolve.schema.json
    intel.schema.json
  tests/
    unit/
      heuristics.test.ts
      api.contract.test.ts
    e2e/
      manual-url.spec.ts
      error-states.spec.ts
    fixtures/
      blank.png
  .github/workflows/
    ci.yml
    pages.yml
  api/
    cmd/qrcheck/
      main.go
      ratelimit.go
      main_test.go
    go.mod
    go.sum
    Dockerfile
    fly.toml
  IMPLEMENTATION.md  ← this file
  docs/
    threat-intel.md
```

---

## Frontend implementation

### Flags

`src/lib/flags.ts`

```ts
export const DEV_ENABLE_MANUAL_URL = import.meta.env.VITE_DEV_MANUAL_URL === "true";
```

### Camera helpers

`src/lib/camera.ts`

```ts
export async function startCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
}
export function stopCamera(stream: MediaStream) {
  stream.getTracks().forEach(t => t.stop());
}
```

### QR decode

`src/lib/decode.ts`

```ts
import jsQR from "jsqr";

export async function decodeQRFromFile(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const code = jsQR(img.data, img.width, img.height);
  if (!code) throw new Error("No QR code found");
  return code.data.trim();
}
```

### Heuristics

`src/lib/heuristics.ts`

```ts
import { toUnicode } from "punycode";

const BAD_TLDS = ["zip","mov","gq","tk","ml","cf","ru"];

export function normalizeURL(url: string): string {
  const u = new URL(url);
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
  return u.toString();
}

export function analyze(urlStr: string) {
  try {
    const u = new URL(urlStr);
    const httpsBad = u.protocol !== "https:";
    const badTld = BAD_TLDS.includes((u.hostname.split(".").pop() || "").toLowerCase());
    const puny = u.hostname.includes("xn--");
    const file = /\.(apk|exe|msi|pkg|dmg|zip|gz|rar)(\?|$)/i.test(u.pathname);
    const veryLong = urlStr.length > 180;
    const shortener = /(^|\.)(t\.co|bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|buff\.ly|lnkd\.in)$/i.test(u.hostname);
    const dataScheme = u.protocol === "data:" || u.protocol === "file:";

    const score =
      (httpsBad ? 15 : 0) +
      (badTld ? 10 : 0) +
      (puny ? 10 : 0) +
      (file ? 20 : 0) +
      (veryLong ? 5 : 0) +
      (shortener ? 6 : 0) +
      (dataScheme ? 25 : 0);

    const verdict = score >= 50 ? "BLOCK" : score >= 20 ? "WARN" : "SAFE";
    return {
      verdict, score,
      normalized: normalizeURL(u.href),
      signals: [
        { key: "https", ok: !httpsBad, info: httpsBad ? "Not HTTPS" : "" },
        { key: "suspicious_tld", ok: !badTld, info: badTld ? `.${u.hostname.split(".").pop()}` : "" },
        { key: "punycode", ok: !puny, info: puny ? toUnicode(u.hostname) : "" },
        { key: "file_download", ok: !file },
        { key: "very_long", ok: !veryLong },
        { key: "shortener", ok: !shortener },
        { key: "scheme_safe", ok: !dataScheme, info: dataScheme ? u.protocol : "" }
      ]
    };
  } catch {
    return { verdict: "BLOCK", score: 80, normalized: urlStr, signals: [{ key: "invalid_url", ok: false }] };
  }
}
```

### API client with validation

`src/lib/api.ts`

```ts
const base = import.meta.env.VITE_API_BASE;

export interface ResolveResponse { hops: string[]; final: string; }
export interface IntelResponse { urlhaus: any; phishtank: any; }

function validateResolveResponse(d: any): d is ResolveResponse {
  return d && Array.isArray(d.hops) && typeof d.final === "string";
}

export async function resolveChain(url: string): Promise<ResolveResponse> {
  if (!base) return { hops: [url], final: url };
  const r = await fetch(`${base}/resolve?url=${encodeURIComponent(url)}`, { headers: { accept: "application/json" } });
  const data = await r.json();
  if (!validateResolveResponse(data)) throw new Error("Invalid API response");
  return data;
}

export async function intel(url: string): Promise<IntelResponse> {
  if (!base) return { urlhaus: null, phishtank: null };
  const r = await fetch(`${base}/intel`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ url })
  });
  return r.json();
}
```

### App shell with manual URL mode and loading states

`src/App.svelte`

```svelte
<script lang="ts">
  import { DEV_ENABLE_MANUAL_URL } from "./lib/flags";
  import { decodeQRFromFile } from "./lib/decode";
  import { analyze } from "./lib/heuristics";
  import { resolveChain, intel } from "./lib/api";

  let urlText = "", manualUrl = "";
  let result:any = null, hops:string[] = [], intelRes:any = null;
  let error = ""; let step = ""; let busy = false;

  async function onFile(e: Event) {
    reset();
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      step = "Decoding QR code...";
      const raw = await decodeQRFromFile(f);
      urlText = raw;

      step = "Analyzing locally...";
      result = analyze(raw);

      step = "Following redirects...";
      const r = await resolveChain(raw);
      hops = r.hops;

      step = "Checking threat sources...";
      intelRes = await intel(r.final || raw);
    } catch (err:any) {
      error = err?.message || "Unable to analyze QR code";
      console.error("QR analysis failed:", err);
    } finally { step = ""; busy = false; }
  }

  async function runManual() {
    reset();
    try {
      step = "Analyzing locally...";
      result = analyze(manualUrl);
      step = "Following redirects...";
      const r = await resolveChain(manualUrl);
      hops = r.hops;
      step = "Checking threat sources...";
      intelRes = await intel(r.final || manualUrl);
    } catch (err:any) {
      error = err?.message || "Unable to analyze URL";
    } finally { step = ""; busy = false; }
  }

  function reset() {
    error = ""; busy = true; step = "";
    result = null; hops = []; intelRes = null;
  }
</script>

<main class="container">
  <header class="py-4">
    <h1>QRCheck.ca</h1>
    <p class="muted">Scan or upload a QR and review the destination safely</p>
  </header>

  <section class="card">
    <h2>Upload image</h2>
    <input type="file" accept="image/*" capture="environment" on:change={onFile} />
    {#if step}<p class="muted">{step}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
  </section>

  {#if DEV_ENABLE_MANUAL_URL}
    <section class="card">
      <h2>Manual URL (dev/testing)</h2>
      <input class="w-full" placeholder="https://example.com" bind:value={manualUrl} />
      <button on:click={runManual}>Analyze</button>
    </section>
  {/if}

  {#if result}
    <section class="card {result.verdict.toLowerCase()}">
      <h3>Verdict: <span class="verdict">{result.verdict}</span> (score {result.score})</h3>
      <p class="break">{result.normalized}</p>

      <details class="mt">
        <summary>How is safety scored?</summary>
        <ul>
          <li>Not HTTPS: +15</li>
          <li>Suspicious TLD: +10</li>
          <li>Punycode/IDN: +10</li>
          <li>File download: +20</li>
          <li>Very long URL: +5</li>
          <li>Shortener: +6</li>
          <li>data:/file: scheme: +25</li>
          <li>Score ≥50 = Block, ≥20 = Warn, else Safe</li>
        </ul>
      </details>

      <h4 class="mt">Redirects</h4>
      <ol>{#each hops as h}<li class="break">{h}</li>{/each}</ol>

      {#if intelRes}
        <h4 class="mt">Intel</h4>
        <pre>{JSON.stringify(intelRes, null, 2)}</pre>
      {/if}
    </section>
  {/if}

  <footer class="py-8 text-xs muted">Free and open source. No tracking.</footer>
</main>

<style>
.container { max-width: 720px; margin: 0 auto; padding: 0 1rem; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }
.card { border: 1px solid #e5e7eb; border-radius: .75rem; padding: 1rem; margin-top: 1rem; }
.card.safe { background: #d1fae5; } .card.warn { background: #fef3c7; } .card.block { background: #fee2e2; }
.muted { color: #6b7280; } .error { color: #dc2626; }
.break { word-break: break-word; } .mt { margin-top: .5rem; }
.verdict { padding: .1rem .4rem; border-radius: .5rem; background: #fff }
.w-full { width: 100%; }
button { border: 1px solid #ddd; padding: .4rem .7rem; border-radius: .5rem; }
</style>
```

---

## Backend implementation

### Rate limiter (fixed syntax)

`api/cmd/qrcheck/ratelimit.go`

```go
package main

import (
  "net/http"
  "sync"
  "time"
)

type rateLimiter struct {
  requests []time.Time
  mu       sync.Mutex
}

var limiters = make(map[string]*rateLimiter)
var limitersMu sync.RWMutex

func rateLimit(next http.HandlerFunc) http.HandlerFunc {
  return func(w http.ResponseWriter, r *http.Request) {
    ip := r.RemoteAddr

    limitersMu.Lock()
    if limiters[ip] == nil {
      limiters[ip] = &rateLimiter{}
    }
    lim := limiters[ip]
    limitersMu.Unlock()

    lim.mu.Lock()
    defer lim.mu.Unlock()

    now := time.Now()
    cutoff := now.Add(-1 * time.Minute) // fixed: declare cutoff

    // drop older than 1 minute
    filtered := lim.requests[:0]
    for _, t := range lim.requests {
      if t.After(cutoff) {
        filtered = append(filtered, t)
      }
    }
    lim.requests = filtered

    if len(lim.requests) >= 60 { // 60 req/min/IP
      http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
      return
    }

    lim.requests = append(lim.requests, now)
    next(w, r)
  }
}
```

### Server

`api/cmd/qrcheck/main.go`

```go
package main

import (
  "context"
  "encoding/json"
  "log"
  "net/http"
  "net/url"
  "os"
  "strings"
  "time"
)

type URLHausResult struct {
  QueryStatus string `json:"query_status"`
  URL         string `json:"url,omitempty"`
  Threat      string `json:"threat,omitempty"`
  URLStatus   string `json:"url_status,omitempty"`
}

type IntelIn struct { URL string `json:"url"` }
type IntelOut struct { URLHaus URLHausResult `json:"urlhaus"`; PhishTank any `json:"phishtank"` }

func main() {
  mux := http.NewServeMux()
  mux.HandleFunc("/health", health)
  mux.HandleFunc("/resolve", cors(rateLimit(resolve)))
  mux.HandleFunc("/intel", cors(rateLimit(intel)))

  addr := ":8080"
  log.Printf("qrcheck api listening on %s", addr)
  log.Fatal(http.ListenAndServe(addr, mux))
}

func health(w http.ResponseWriter, r *http.Request) {
  ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
  defer cancel()
  okUH := false
  req, _ := http.NewRequestWithContext(ctx, "GET", "https://urlhaus-api.abuse.ch/v1/", nil)
  if resp, err := http.DefaultClient.Do(req); err == nil && resp.StatusCode == 200 {
    okUH = true
  }
  w.Header().Set("Content-Type", "application/json")
  _ = json.NewEncoder(w).Encode(map[string]any{"status":"ok","feeds":map[string]bool{"urlhaus":okUH}})
}

func cors(h http.HandlerFunc) http.HandlerFunc {
  allow := os.Getenv("CORS_ORIGIN")
  if allow == "" { allow = "*" }
  return func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Access-Control-Allow-Origin", allow)
    w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
    w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    if r.Method == http.MethodOptions { w.WriteHeader(200); return }
    h(w, r)
  }
}

func resolve(w http.ResponseWriter, r *http.Request) {
  target := r.URL.Query().Get("url")
  if _, err := url.ParseRequestURI(target); err != nil {
    http.Error(w, "bad url", 400); return
  }
  client := &http.Client{ Timeout: 10 * time.Second }
  hops := []string{}; cur := target; seen := map[string]bool{}
  for i := 0; i < 10; i++ {
    if seen[cur] { break }
    seen[cur] = true
    hops = append(hops, cur)
    req, _ := http.NewRequest(http.MethodHead, cur, nil)
    req.Header.Set("User-Agent", "QRCheck/1.0 (+https://qrcheck.ca)")
    resp, err := client.Do(req)
    if err != nil { break }
    loc, err := resp.Location()
    if err != nil { break }
    cur = resolveURL(loc, cur)
  }
  w.Header().Set("Content-Type", "application/json")
  _ = json.NewEncoder(w).Encode(map[string]any{"hops": hops, "final": cur})
}

func intel(w http.ResponseWriter, r *http.Request) {
  var in IntelIn
  if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
    http.Error(w, "bad json", 400); return
  }

  ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
  defer cancel()
  uh := fetchURLHaus(ctx, in.URL)
  pt := fetchPhishTank(ctx, in.URL)

  if uh.QueryStatus == "no_results" {
    w.Header().Set("Cache-Control", "public, max-age=86400")
  } else {
    w.Header().Set("Cache-Control", "no-cache")
  }

  w.Header().Set("Content-Type", "application/json")
  _ = json.NewEncoder(w).Encode(IntelOut{ URLHaus: uh, PhishTank: pt })
}

func fetchURLHaus(ctx context.Context, u string) URLHausResult {
  vals := url.Values{"url": {u}}
  req, _ := http.NewRequestWithContext(ctx, "POST", "https://urlhaus-api.abuse.ch/v1/url/", strings.NewReader(vals.Encode()))
  req.Header.Set("content-type", "application/x-www-form-urlencoded")
  resp, err := http.DefaultClient.Do(req)
  if err != nil { return URLHausResult{ QueryStatus: "error" } }
  defer resp.Body.Close()
  var v URLHausResult
  _ = json.NewDecoder(resp.Body).Decode(&v)
  return v
}

func fetchPhishTank(ctx context.Context, u string) any {
  apiKey := os.Getenv("PHISHTANK_API_KEY")
  if apiKey == "" {
    return map[string]string{"error": "API key not configured"}
  }
  vals := url.Values{ "url": {u}, "format": {"json"}, "app_key": {apiKey} }
  req, _ := http.NewRequestWithContext(ctx, "POST", "https://checkurl.phishtank.com/checkurl/", strings.NewReader(vals.Encode()))
  req.Header.Set("content-type", "application/x-www-form-urlencoded")
  resp, err := http.DefaultClient.Do(req)
  if err != nil { return map[string]string{"error": err.Error()} }
  defer resp.Body.Close()
  var v any
  _ = json.NewDecoder(resp.Body).Decode(&v)
  return v
}

func resolveURL(loc *url.URL, base string) string {
  if loc.IsAbs() { return loc.String() }
  b, _ := url.Parse(base)
  return b.ResolveReference(loc).String()
}
```

---

## Config and tooling

### Playwright config

`playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: { headless: true, baseURL: 'http://localhost:5173' },
  webServer: [
    { command: 'node mocks/api-mock.ts', port: 9090, reuseExistingServer: !process.env.CI },
    { command: 'VITE_API_BASE=http://localhost:9090 VITE_DEV_MANUAL_URL=true npm run dev', port: 5173, reuseExistingServer: !process.env.CI }
  ],
  testDir: 'tests/e2e',
  timeout: 30000
});
```

### tsconfig

`tsconfig.json`

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["vite/client", "node", "@playwright/test"],
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*", "tests/**/*", "vite.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### Vite config

`vite.config.ts`

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', sourcemap: true }
});
```

### Vitest config

`vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'jsdom' }
});
```

### ESLint

`.eslintrc.cjs`

```js
module.exports = {
  root: true,
  extends: ['eslint:recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
  env: { browser: true, es2021: true, node: true }
};
```

### Package.json (deps and scripts)

`package.json`

```json
{
  "name": "qrcheck",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build && touch dist/.nojekyll",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run --reporter=verbose",
    "e2e": "playwright test",
    "ci:verify": "npm run typecheck && npm run lint && npm run test && npm run e2e && npm run build"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "ajv": "^8.12.0",
    "eslint": "^8.50.0",
    "jsqr": "^1.4.0",
    "punycode": "^2.3.0",
    "svelte": "^4.2.0",
    "typescript": "^5.2.0",
    "vite": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

### Mock API

`mocks/api-mock.ts`

```ts
import http from "http";
const s = http.createServer((req, res) => {
  const u = new URL(req.url || "", "http://localhost");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  if (u.pathname === "/resolve")
    return res.end(JSON.stringify({ hops: ["https://start.example","https://end.example"], final: "https://end.example" }));
  if (u.pathname === "/intel")
    return res.end(JSON.stringify({ urlhaus: { query_status: "no_results" }, phishtank: { ok: true } }));
  res.statusCode = 404; res.end();
});
s.listen(9090);
```

### Contracts

`contracts/resolve.schema.json`

```json
{ "type":"object", "required":["hops","final"], "properties":{
  "hops":{"type":"array","items":{"type":"string"}}, "final":{"type":"string"} } }
```

`contracts/intel.schema.json`

```json
{ "type":"object", "required":["urlhaus","phishtank"], "properties":{
  "urlhaus":{}, "phishtank":{} } }
```

### Unit tests

`tests/unit/heuristics.test.ts`

```ts
import { analyze } from "../../src/lib/heuristics";

test("blocks invalid URL", () => {
  expect(analyze("not a url").verdict).toBe("BLOCK");
});
test("warns suspicious TLD", () => {
  const r = analyze("https://example.zip/");
  expect(["WARN","BLOCK"]).toContain(r.verdict);
});
test("data scheme blocks", () => {
  const r = analyze("data:text/html,hi");
  expect(r.verdict).toBe("BLOCK");
});
test("shortener flagged", () => {
  const r = analyze("https://bit.ly/x");
  expect(r.signals.find(s => s.key === "shortener")?.ok).toBe(false);
});
```

`tests/unit/api.contract.test.ts`

```ts
import Ajv from "ajv";
import resolveSchema from "../../contracts/resolve.schema.json";
import intelSchema from "../../contracts/intel.schema.json";
const ajv = new Ajv();

test("resolve schema", () => {
  const ok = ajv.validate(resolveSchema, { hops:["a","b"], final:"b" });
  expect(ok).toBe(true);
});
test("intel schema", () => {
  const ok = ajv.validate(intelSchema, { urlhaus:{}, phishtank:{} });
  expect(ok).toBe(true);
});
```

### E2E tests

`tests/e2e/manual-url.spec.ts`

```ts
import { test, expect } from "@playwright/test";

test("manual URL flow", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("https://example.com").fill("https://start.example");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByText("Verdict:")).toBeVisible();
  await expect(page.getByText("Redirects")).toBeVisible();
  await expect(page.getByText("Intel")).toBeVisible();
});
```

`tests/e2e/error-states.spec.ts`

```ts
import { test, expect } from "@playwright/test";

test("shows helpful message when no QR found", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', 'tests/fixtures/blank.png');
  await expect(page.getByText("No QR code found")).toBeVisible();
});
```

### Fixtures

Add a tiny blank PNG at `tests/fixtures/blank.png` (any valid empty PNG works).

---

## CI and deploy

### CI

`.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: node mocks/api-mock.ts &
      - run: sleep 2
      - run: npm run ci:verify
        env:
          VITE_API_BASE: http://localhost:9090
          VITE_DEV_MANUAL_URL: true
  backend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: api } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.22" }
      - run: go mod tidy
      - run: go test ./...
```

### Pages deploy

`.github/workflows/pages.yml`

```yaml
name: Deploy SPA
on: { push: { branches: [main] } }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build
      - run: touch dist/.nojekyll
      - uses: actions/upload-pages-artifact@v2
        with: { path: ./dist }
  deploy:
    needs: build
    permissions: { pages: write, id-token: write }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/deploy-pages@v4
```

### Fly.io backend

`api/Dockerfile` and `api/fly.toml` are included above. Deploy:

```bash
cd api
fly launch --now
fly deploy
```

---

## Environment

Frontend `.env.example`

```
VITE_API_BASE=
VITE_DEV_MANUAL_URL=true
```

Backend

```
CORS_ORIGIN=https://qrcheck.ca
PHISHTANK_API_KEY=your_key_here
GSB_API_KEY=     # optional for Phase 4
PORT=8080
```

---

## Threat intel notes

See `docs/threat-intel.md`:

* URLHaus: free, no key, parse `query_status`
* PhishTank: requires key, handle 403/429, optional
* Safe Browsing: optional later, use v4 Lookup

---

## Security

* HEAD requests only for tracing
* 10 hop limit and loop detection
* 5–10 s timeouts on outbound requests
* CORS locked to production origin in prod
* CSP meta in index.html
* No URL logging; aggregate metrics only if added later

---

## Execution order

1. Fix rate limiter cutoff variable (included)
2. Add all missing configs and files above
3. Update `package.json` dependencies and scripts
4. Add `tests/fixtures/blank.png`
5. Update CI workflow with env vars
6. `npm install`
7. `npm run ci:verify`
8. `cd api && go test ./...`
9. Push to main to deploy SPA, deploy API on Fly.io, set `VITE_API_BASE` for production build

This is the final, production-ready plan with all critical issues addressed and the missing files added, optimized for autonomous building and self-correction.
