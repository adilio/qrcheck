# QRCheck — Plan

QRCheck is a privacy-first QR/URL security analyzer. The engine is a working
tiered heuristic (`src/lib/heuristics-tiered.ts`) plus live threat intel (Google
Safe Browsing v5, URLHaus). The YAGNI cleanup and a first performance pass
(commit `9db8084`, "20x faster results") are already done — see the archived
section below. This plan covers the next phase: **real functionality that closes
the remaining security gaps, and performance work on what's left.**

## Executing this with Fable

- Run at `high`/`xhigh` effort; give each item its full spec up front in one turn.
- ⚠️ **Refusal caveat — this is the most refusal-prone repo in the fleet.**
  URL-threat-analysis prompts can trip Fable's cyber safety classifiers even on
  benign work. For any Fable API calls added to this repo, enable server-side
  fallbacks (`betas: ["server-side-fallback-2026-06-01"]`,
  `fallbacks: [{ model: "claude-opus-4-8" }]`). If Fable false-positives on the
  analysis *logic* itself, Opus 4.8 is a reasonable executor.
- Verify each item with `npm run ci:verify` (typecheck + lint + test + e2e + build).

## Prerequisite decision (blocks clean F1/F2)

- ✅ **Signal model — DECIDED: committed to the tiered engine (`#15`).** The tiered
  engine (`heuristics-tiered.ts`) is live and feature-complete; the
  `UrlSignals`/`analyzeUrl` model was already deleted in the YAGNI cleanup. The
  last remnants of the non-tiered path — `src/lib/expand.ts` (client-side
  expansion, dead since resolution moved to the Netlify function),
  `src/lib/domainAge.ts` (dead client RDAP wrapper), `src/types.ts`
  (`RedirectExpansion` types used only by `expand.ts`) — are removed. All new
  signals (F1–F3) attach to the tiered engine.

## Real functionality

### ✅ F1. Redirect-chain expansion (`#13`) — DONE

> Shipped: `functions/resolve.ts` refactored around a testable
> `followRedirectChain` — loop detection, per-hop + overall timeouts, hop cap,
> mid-chain SSRF blocking, and partial chains returned with a `reason` instead
> of throwing. The client analyzes the resolved final URL (P3 plumbing), shows
> the hop chain with a "may be incomplete" badge on partial results, and the
> verdict-gated continue-to-site action (`#11`) landed in ResultsCard: safe →
> "Open site"; caution → copy-first + explicit two-step "Open anyway"; danger →
> copy only. 8 resolver unit tests cover loop/timeout/max-hop/SSRF; verified
> live against bit.ly and tinyurl.

### F1 (original spec). Redirect-chain expansion (`#13`) — highest correctness value

Unroll shortened/redirecting URLs so the verdict reflects the *final* destination,
not the shortener. Today it's CORS-blocked in the browser and no-op'd; resolution
belongs in the existing Netlify function.

- **Scope:** the Netlify resolver follows the redirect chain server-side (HTTP 3xx
  plus known-shortener expansion) and returns ordered hops + final URL; the client
  renders the chain and runs heuristics on the final URL.
- **Guardrails:** cap hops (~10); per-hop and total timeout via `AbortController`;
  detect redirect loops; never auto-fetch destination page bodies; treat every hop
  as untrusted; surface partial chains on failure.
- **Continue-to-site button (`#11`):** once the final destination is known, offer
  an explicit action to open it — gated on the verdict. Safe → a normal "Open
  site" button; risky → show the resolved final URL, require a confirm, and prefer
  "copy URL" over auto-launch. Never one-click-launch a URL the tool just flagged.
- **Done when:** pasting a `bit.ly`/`t.co` shows the full hop list, scores the real
  endpoint, and offers a verdict-gated continue action; unit tests cover loop,
  timeout, and max-hop cases.

### ✅ F2. Real domain-age / reputation signal (`#14`) — DONE

> Shipped: `functions/check-domain-age.ts` rebuilt — RDAP lookup with a 5s
> timeout, registrable-domain normalization (www./deep subdomains, co.uk-style
> ccTLDs), a 12h warm-instance cache server-side plus a 24h TTLCache client-side
> (determinate results only). Newly-registered domains add +20/+10 risk;
> established (5y+) domains now subtract 10 (score floor 0, from P3); failures
> degrade to "unknown" with zero points. 14 unit tests; verified live
> (google.com/bbc.co.uk/anthropic.com → established −10; a transient RDAP
> rate-limit degraded gracefully to unknown).

### F2 (original spec). Real domain-age / reputation signal (`#14`)

Replace the removed `Math.random()` placeholder with a genuine signal. A "security"
analyzer currently has no real reputation input.

- **Scope:** add a domain-age/reputation check (RDAP for registration date — free,
  no API key; optionally a reputation feed) as a Tier-3 signal feeding the tiered
  score. Feature-flag / degrade gracefully when the lookup is unavailable.
- **Guardrails:** run the RDAP call server-side (Netlify) with a timeout and cache
  (reuse `TTLCache` from `src/lib/cache.ts`); newly-registered domains raise risk,
  established domains lower it; never hard-fail the verdict on lookup error.
- **Done when:** a freshly-registered domain visibly raises risk vs an aged one;
  the result is cached; a missing/slow lookup degrades to "unknown," not an error.

### F3. Payload-type-aware risk analysis — highest-value new capability

The decoder already parses non-URL QR payloads (`url`, `text`, `email`, `phone`,
`sms`, `wifi`, `vcard`, `geo` — see `src/lib/decode.ts`), but the security engine
only scores URLs. Extend risk analysis to the other payload types so the verdict
covers what the QR actually *does*, not just links.

- **Scope:** per-type checks feeding the tiered verdict — e.g. `sms`/`tel` to
  premium or unexpected numbers; `wifi` joining an open/rogue network (surface the
  SSID + auth type so the user sees it before joining); `vcard` with an embedded
  URL or mismatched fields; `geo`/`mailto` sanity. Each type gets its own signal
  set; URL-bearing payloads still run the full URL engine.
- **Guardrails:** never auto-act on any payload (never auto-join WiFi, dial, or
  send an SMS) — the verdict is advisory only. Unknown types degrade to a neutral
  "can't assess," never a false "safe."
- **Done when:** scanning a non-URL QR shows a type-appropriate verdict instead of
  the current URL-only treatment; unit tests cover each payload type.

### F4. Detect multiple URLs and let the user choose

A single QR/scanned payload can carry more than one URL (e.g. a vCard or text
block with several links). Today the app assumes one URL and picks implicitly.
Instead, detect every URL in the payload and let the user choose which to analyze.
(Not currently tracked as a GitHub issue — captured here.)

- **Scope:** extract all URLs from the decoded content; if more than one, present a
  chooser (each URL with its host) and analyze the selected one. A single-URL
  payload keeps today's zero-click flow unchanged.
- **Guardrails:** don't resolve, pre-fetch, or run intel on any URL until the user
  picks one (avoids network work on links the user never chose); normalize/truncate
  display so long URLs stay readable and unspoofable.
- **Done when:** a multi-URL payload shows a picker and analyzes only the chosen
  URL; a single-URL payload behaves exactly as before.

## Performance

### P1. Lazy-load the QR decoder (`jsqr`)

`jsqr` (~252 KB, the bulk of the shipped bundle) loads on every visit but is only
needed when a user *scans an image* — not when pasting a URL. Dynamic-import it on
first scan.

- **Done when:** initial JS payload drops by roughly jsqr's weight; scanning still
  works (first scan may show a brief "loading decoder"); the split is confirmed in
  `vite build` output.

### P2. Compact URLHaus lookup

The URLHaus host DB ships as a **352 KB `public/urlhaus/hosts.json`** fetched at
runtime and checked client-side per lookup. Replace it with a compact index
(hashed set / Bloom filter generated at build time) for a smaller payload and O(1)
membership.

- **Done when:** the runtime payload for the URLHaus check is materially smaller;
  lookups are constant-time; if a Bloom filter is used, its false-positive rate is
  documented and acceptable; StaleWhileRevalidate still refreshes it.

### ✅ P3. Parallelize + bound Tier-3 signals — DONE (a06c9de)

> Shipped: Tier 2 and Tier 3 run concurrently via a signal-delta harness in
> `heuristics-tiered.ts`; every network call in `api.ts` has its own
> AbortController timeout; hung/failed signals degrade to "unknown"; the live
> URLHaus lookup runs concurrently with the tiered analysis; 13 unit tests
> cover ordering, timeout, and degradation. F1/F2 signals attach here.

Tier-3 runs several independent network checks (Safe Browsing, URLHaus, redirect
resolve, domain age). Run them concurrently with `Promise.allSettled` and per-signal
`AbortController` timeouts, rendering progressively so one slow signal never blocks
the verdict.

- **Note:** F1 and F2 both add Tier-3 network signals — build them *inside* this
  concurrency/timeout harness so latency stays flat as signals are added.
- **Done when:** worst-case verdict latency is bounded by the slowest single
  signal's timeout, not the sum; a hung signal degrades to "unknown" without
  blocking the verdict.

## Suggested order

1. Signal-model decision (quick; unblocks F1/F2).
2. P3 concurrency harness (so F1/F2/F3 land inside it).
3. F1 redirect expansion (incl. the `#11` continue-to-site button) → F2 domain
   reputation.
4. F3 payload-type-aware analysis, then F4 multiple-URL chooser (both build on the
   decoder; F4 is lighter and can slot earlier if you prefer a quick win).
5. P1 lazy decoder, P2 compact URLHaus (independent; any time).

---

# Archived — YAGNI Cleanup (completed & verified)

> Everything below was executed and verified against git history: dead analysis
> engines removed, dependency footprint trimmed, precache slimmed
> (`share-card.png` + `urlhaus/hosts.json` excluded via `globIgnores`), the dead
> `node:crypto` branch removed, `netlify-cli` de-vendored to `npx`, and `jsqr`
> promoted to `dependencies`. Kept for reference only.

## YAGNI Cleanup Plan — qrcheck

This plan captures the findings from a YAGNI ("You Aren't Gonna Need It") review
of the codebase. The app works, but it carries speculative and superseded
machinery — most notably **three parallel URL-analysis engines, only one of
which is actually used**.

Each item below notes the location, why it's a YAGNI violation, and the
proposed action. Items are grouped by risk so they can be applied in
reviewable commits.

---

## 🔴 Major: three competing analysis implementations

| Engine | Location | Status |
|---|---|---|
| `analyzeHeuristicsTiered` | `src/lib/heuristics-tiered.ts` | **Live** — the only one App.svelte calls (`App.svelte:666`) |
| `analyzeHeuristics` | `src/lib/heuristics.ts:120` | Imported at `App.svelte:6` but **never called** — dead |
| `analyzeUrl` | `src/lib/heuristics.ts:884` | Used **only by its own test** (`tests/unit/heuristics.test.ts`) — dead in the app |

- `analyzeHeuristics` (~200 lines) and its private helpers — `checkObfuscation`,
  `checkSuspiciousKeywords`, `checkDomainReputation`, `checkTyposquatting`,
  `checkHomographs`, `checkEnhancedSuspiciousKeywords` — are **reimplemented
  inline** inside `heuristics-tiered.ts`. The logic exists twice; one copy is
  unreachable.
- `analyzeUrl` is a *third* scoring scheme with its own shape
  (`UrlAnalysisResult`/`UrlAnalysisOptions` local to `heuristics.ts`) that exists
  solely to satisfy its own test.
- After removing the dead functions, `heuristics.ts` collapses to just the
  `HeuristicResult` / `Formatted*` types and `formatHeuristicResults` (both
  genuinely used).

**Action:** Delete `analyzeHeuristics` + its private helpers. Delete `analyzeUrl`
+ `UrlAnalysisResult`/`UrlAnalysisOptions` (local to `heuristics.ts`) and its
test file `tests/unit/heuristics.test.ts`.

---

## 🔴 Speculative / no-op logic

- **`resolveViaProxy` → `detectRedirectsViaFetch`** (`src/lib/api.ts:122-157`):
  fires a HEAD request at `allorigins.win`, **discards the result**, and always
  returns `{ hops: [url], final: url }`. Adds a network round-trip and does
  nothing. Comments admit it ("limited by browser security", "for now").
  **Action:** Remove both functions and the call site in `resolveChainWithFallback`.
- **Fake "new domain" detection** (`src/lib/heuristics.ts:454-457`): `isNewDomain`
  is computed with `Math.random() > 0.7` — a non-deterministic placeholder
  masquerading as a signal. (Removed automatically with `analyzeHeuristics`;
  must not survive any cleanup.)
- **`base` / `VITE_API_BASE` fallback path** (`src/lib/api.ts:50-63`): a second
  resolve backend layered under the Netlify function. If only Netlify ships,
  this is unused contingency. **Action:** Confirm intent; remove if not used.

---

## 🟠 Dead exports & unused imports

- `expandFirstHop`, `expandFullChain` (`src/lib/expand.ts:234,248`) — imported at
  `App.svelte:15`, **never used**. Thin wrappers around `expandUrl`.
  **Action:** Delete both functions and the import.
- `analyzeHeuristics` import (`App.svelte:6`) — unused (`.svelte` files aren't
  covered by `lint --ext .ts`, so it slips past lint). **Action:** Remove import.
- `src/types.ts` — `UrlSignals`, `UrlAnalysisResult`, `UrlAnalysisOptions`, and
  `Verdict` are **all unused**. Only `RedirectExpansion` and
  `ExpansionFailureReason` are referenced. This is a spec'd-out result shape the
  app never adopted (it went with the tiered `HeuristicResult` instead).
  **Action:** Delete the four unused types; keep the two used ones.

---

## 🟠 Duplication (DRY, adjacent to YAGNI)

- `levenshteinDistance` defined twice (`heuristics.ts:1063`,
  `heuristics-tiered.ts:462`). **Action:** Hoist to one shared util (after the
  dead `heuristics.ts` copy is removed, this resolves on its own).
- `knownShorteners` array duplicated **3×** in `api.ts` (lines 102, 198, 242).
  **Action:** Hoist to a single module-level constant.
- `reputableShorteners` / `mediumRiskShorteners` arrays duplicated across both
  heuristics files. **Action:** Resolves once the dead `heuristics.ts` copy is
  removed; otherwise hoist to shared data.
- Keyword-category maps duplicated between the two heuristics files (with
  slightly different contents — a latent inconsistency). **Action:** Single source.

---

## What's fine (no action)

- `DEV_ENABLE_MANUAL_URL` (`src/lib/flags.ts`) — legitimate dev flag.
- `TTLCache` / `fetchWithLocalCache` (`src/lib/cache.ts`) — genuinely used.
- `expandUrl`, `resolveChain`, `intel`, `checkAllThreatIntel` — all wired up.
- The tiered analysis design itself is reasonable.

---

## Deferred / intentionally not built (tracked as issues)

Some of the code being removed represents *unfinished intent*, not just
redundancy. To keep the repo clean without losing the ask, each is captured as
a GitHub issue and the stub is then deleted (recoverable from git history if
revived):

- **Client-side redirect expansion for CORS-blocked shorteners** —
  [#13](https://github.com/adilio/qrcheck/issues/13). The `resolveViaProxy` /
  `detectRedirectsViaFetch` no-op was an attempt at this; the Netlify resolver
  may already make it redundant.
- **Real domain-reputation / domain-age signal** —
  [#14](https://github.com/adilio/qrcheck/issues/14). Replaces the
  `Math.random()` placeholder; the live Tier 3 domain-age check may already
  cover it.
- **Signal-by-signal analysis model (`UrlSignals` / `analyzeUrl`)** —
  [#15](https://github.com/adilio/qrcheck/issues/15). Designed but never adopted;
  decide whether to adopt or permanently drop in favor of the tiered model.

> Note: the redundant code in the sections above (e.g. duplicate
> `analyzeHeuristics`, dead exports) carries **no** lost intent — the feature
> lives on in `analyzeHeuristicsTiered`. Only the three items here represent
> asks worth tracking.

---

## Suggested commit sequence

1. **Zero-risk deletions** — `analyzeHeuristics` + dead helpers,
   `expandFirstHop`/`expandFullChain`, unused imports, unused `types.ts` members.
2. **`analyzeUrl` + its test** — removes a tested-but-unused engine (deletes test
   coverage, so isolate it).
3. **No-op proxy path** — remove `resolveViaProxy`/`detectRedirectsViaFetch`.
4. **De-dup** — hoist `knownShorteners`; shortener/keyword lists consolidate once
   the dead copies are gone.

Run `npm run typecheck && npm run lint && npm run test` before pushing.

**Estimated removal:** ~600+ lines with zero behavioral change to the app.

---

## Dependency & bundle audit (YAGNI)

Findings from tracing every dependency to its actual usage, plus measuring the
installed tree (`node_modules` = **502 MB / 1,544 packages**) and the shipped
production build (browser bundle = **258 KB raw / 90 KB gzip**; PWA precache =
**~1.6 MB**).

### Declared dependencies never imported — remove

| Package | Declared as | Why it's dead |
|---|---|---|
| `ajv-formats` | `dependencies` | Never imported; the one contract test uses bare `ajv` with no `addFormats` |
| `undici` | `dependencies` | Never imported; Netlify functions use global `fetch` (Node 18+) |
| `punycode` | `devDependencies` | Never imported (only appears as object keys/strings); detection uses `xn--` matching; Node has a builtin |
| `esbuild` | `devDependencies` | Never imported directly; Vite and Netlify each bundle their own copy transitively |

> After removing the two `dependencies`, the app ships with **zero used runtime
> dependencies** in that block — everything is bundled by Vite or is a builtin.

### Replace with our own code

- **`ajv`** (devDep) — used by a single test (`tests/unit/api.contract.test.ts`)
  validating two trivial schemas. Replace with ~10 lines of hand-rolled shape
  checks (the existing `validateResolveResponse` in `api.ts` is the pattern).
  Dropping it also makes `contracts/*.schema.json` optional.

### The big one: `netlify-cli` transitive bloat

`netlify-cli` (devDep) is responsible for the **vast majority** of the 502 MB
install tree:

- Declares **98 direct dependencies**; the heaviest packages alone total
  **≥175 MB**.
- Pulls in machinery wholly irrelevant to a QR scanner: `@electric-sql/pglite`
  (**full Postgres-in-WASM, 22 MB**), `@octokit/rest` (**GitHub API client,
  17 MB**), `@opentelemetry/*` (tracing, 22 MB), `rxjs`, `zod` (×2 majors),
  `svgo`, `inquirer-autocomplete-prompt`, `web-streams-polyfill`.
- Used only by `npm run dev:netlify`.

**Action:** change `dev:netlify` to `npx netlify-cli dev` and drop `netlify-cli`
from `devDependencies`. Reclaims the majority of the install tree and ~half the
package count, with no impact on the app, build, or CI. (Production dep tree is
**9 packages**.) This is the single biggest footprint win in the repo.

### Misclassified — move, don't remove

- **`jsqr`** is under `devDependencies` but is imported at runtime by
  `src/lib/decode.ts` and is ~252 KB of the shipped bundle (the core QR decoder).
  **Move to `dependencies`.** Never rewrite it — QR decoding is genuinely hard.

### Shipped-weight YAGNI (assets in the PWA precache, not packages)

The browser **bundle** is already lean (jsqr is essentially the whole 90 KB
gzip). The waste is in precached assets — every user downloads these on first
load:

| Precached file | Size | Action |
|---|---|---|
| `share-card.png` | **692 KB** | Larger than the entire JS bundle; it's a social-share image with no offline need. **Exclude from precache** (and/or compress). |
| `urlhaus/hosts.json` | **352 KB** | Already fetched at runtime via `StaleWhileRevalidate`, so the 13,208-host DB ships **twice**. **Drop from precache**, let runtime caching own it. |

Trimming both roughly **halves** the first-load payload. Tune
`workbox.globPatterns` in `vite.config.mts` accordingly.

### Package-level dead spots surfaced by the build

- **`node:crypto` fallback** (`src/lib/expand.ts:41`) — Vite externalizes it for
  the browser; it's a fallback after `crypto.subtle` (line 32), which is always
  present in browsers, so the branch is dead in the shipped build. Remove it.
- **`api.ts` is both statically and dynamically imported** — the build warns this
  defeats code-splitting (it folds into the main chunk). Resolves once the static
  import in `App.svelte` is cleaned up (see the dead-import item above).

### Leave alone

- `overrides` block (`serialize-javascript`, `uuid`, `@fastify/static`, `qs`) —
  security pins for transitive deps, not direct deps. Keep; revisit periodically.
- Toolchain (`vite`, `svelte`, `@sveltejs/vite-plugin-svelte`, `vite-plugin-pwa`,
  `typescript`, `@types/node`, `@netlify/functions` types) and test/lint stack
  (`vitest`, `@vitest/coverage-v8`, `jsdom`, `@playwright/test`, `eslint`,
  `@typescript-eslint/*`) — all genuinely used.

### Suggested dependency cleanup order

1. Drop unused: `ajv-formats`, `undici`, `punycode`, `esbuild`.
2. De-vendor `netlify-cli` → `npx`; biggest footprint win.
3. Move `jsqr` to `dependencies`.
4. Replace `ajv` with hand-rolled validation; drop `ajv` (+ optionally the schema files).
5. Trim PWA precache: exclude `share-card.png` and `urlhaus/hosts.json`.
6. Remove the dead `node:crypto` branch in `expand.ts`.

Verify after each step: `npm install` succeeds, `npm run ci:verify` passes, and
`npx vite build` produces a working bundle.
