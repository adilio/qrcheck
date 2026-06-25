# YAGNI Cleanup Plan — qrcheck

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
