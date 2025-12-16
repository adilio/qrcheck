# QRCheck - Next Steps & Roadmap

## Current Status ✅

**P0 Performance Improvements:** COMPLETE
- ✅ Time to first result: <100ms (20x faster)
- ✅ Parallel API calls: 60-80% faster
- ✅ Build-time data fetching: Zero nightly commits
- ✅ Tiered heuristics: Progressive results

**Known Issue Fixed:**
- ✅ Redirect expansion now uses Netlify Functions for CORS-protected shorteners

---

## Phase 2: Results Display Improvements (P1 - High Impact)

**Goal:** Create a beautiful, intuitive UI that clearly shows progressive loading states.

### 2.1 Create Progressive Results UI Component

**Priority:** High
**Effort:** Medium (4-6 hours)
**Impact:** Very High (user experience)

**Tasks:**
1. Create `src/components/ResultsCard.svelte`
   - Verdict banner with color-coded risk levels
   - Progressive loading indicators for each tier
   - Skeleton loaders for pending checks
   - Smooth fade-in transitions as tiers complete

2. Update `src/App.svelte` to use ResultsCard
   - Pass progressive data as props
   - Update props as each tier completes
   - Handle tier1, tier2, tier3 states

3. Visual improvements:
   - Add animated spinner for "Analyzing..." state
   - Pulse animation for pending checks (⏳)
   - Green checkmark animation when tier completes (✓)
   - Confetti animation for all-clear verdict

**Mockup:**
```
┌─────────────────────────────────────────┐
│  🔒 LOW RISK                            │
│  This URL appears safe to visit         │
├─────────────────────────────────────────┤
│  Quick Checks              All Passed ✓ │
│  ├─ Secure connection (HTTPS)      ✓   │
│  ├─ Reputable shortener            ✓   │
│  └─ No suspicious patterns         ✓   │
├─────────────────────────────────────────┤
│  Threat Intelligence       ⏳ Checking  │
│  ├─ Google Safe Browsing   ✓ Clear     │
│  ├─ URLHaus Database       ⏳ Checking  │
│  └─ Domain Age             ⏳ Checking  │
└─────────────────────────────────────────┘
```

**Files to Create:**
- `src/components/ResultsCard.svelte`
- `src/components/ProgressIndicator.svelte`
- `src/components/CheckItem.svelte`

**Files to Modify:**
- `src/App.svelte` (integrate ResultsCard)
- `src/app.css` (add new animations)

---

## Phase 4: Production Hardening (P2 - Medium Impact)

**Goal:** Make the app more resilient, observable, and secure.

### 4.1 Enhanced Caching Strategy

**Priority:** Medium
**Effort:** Low (2-3 hours)
**Impact:** Medium (performance)

**Tasks:**
1. Update `src/lib/cache.ts` with variable TTLs:
   ```typescript
   const CACHE_TTLS = {
     THREAT_INTEL: 4 * 60 * 60 * 1000,      // 4 hours
     DOMAIN_AGE: 24 * 60 * 60 * 1000,       // 24 hours
     REDIRECT_CHAIN: 4 * 60 * 60 * 1000,    // 4 hours
     SHORTENER_LIST: 7 * 24 * 60 * 60 * 1000 // 7 days
   };
   ```

2. Update `netlify.toml` with improved caching:
   ```toml
   [[headers]]
     for = "/api/*"
     [headers.values]
       Cache-Control = "public, max-age=300, stale-while-revalidate=600"
   ```

3. Implement cache warming on app initialization:
   - Preload shortener list on first visit
   - Prefetch URLHaus hosts in background

**Files to Modify:**
- `src/lib/cache.ts`
- `netlify.toml`
- `src/App.svelte` (add cache warming in onMount)

### 4.2 Error Handling & Resilience

**Priority:** Medium
**Effort:** Medium (3-4 hours)
**Impact:** High (reliability)

**Tasks:**
1. Add graceful degradation to `src/lib/heuristics-tiered.ts`:
   ```typescript
   try {
     const tier3 = await analyzeTier3(content, tier2Result);
   } catch (error) {
     console.warn('Tier 3 analysis failed:', error);
     return {
       ...tier2Result,
       tier3: { status: 'error', message: 'Some checks unavailable' }
     };
   }
   ```

2. Create `src/lib/retry.ts` with exponential backoff:
   ```typescript
   export async function fetchWithRetry(
     url: string,
     options: RequestInit,
     maxRetries = 3
   ): Promise<Response> {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await fetch(url, options);
       } catch (error) {
         if (i === maxRetries - 1) throw error;
         await new Promise(resolve =>
           setTimeout(resolve, Math.pow(2, i) * 1000)
         );
       }
     }
   }
   ```

3. Implement circuit breaker pattern:
   - Track failure rate per API endpoint
   - Open circuit after 5 consecutive failures
   - Close circuit after 60 seconds

**Files to Create:**
- `src/lib/retry.ts`
- `src/lib/circuit-breaker.ts`

**Files to Modify:**
- `src/lib/heuristics-tiered.ts`
- `src/lib/api.ts`

### 4.3 Rate Limiting & Abuse Prevention

**Priority:** Low
**Effort:** Low (2-3 hours)
**Impact:** Medium (security)

**Tasks:**
1. Add rate limiting to all Netlify functions:
   - Copy `RateLimiter` class from `functions/resolve.ts`
   - Apply 20 requests/minute for threat intel
   - Apply 5 requests/minute for domain age

2. Implement client-side request deduplication:
   ```typescript
   const pendingRequests = new Map<string, Promise<any>>();

   export async function deduplicatedFetch(
     key: string,
     fetcher: () => Promise<any>
   ) {
     if (pendingRequests.has(key)) {
       return pendingRequests.get(key);
     }
     const promise = fetcher().finally(() =>
       pendingRequests.delete(key)
     );
     pendingRequests.set(key, promise);
     return promise;
   }
   ```

**Files to Modify:**
- `functions/check-domain-age.ts`
- `functions/check-threat-intel.ts`
- `src/lib/api.ts`

### 4.4 Monitoring & Observability

**Priority:** Low
**Effort:** Low (1-2 hours)
**Impact:** Low (ops visibility)

**Tasks:**
1. Add function execution time logging:
   ```typescript
   const startTime = Date.now();
   // ... function logic ...
   console.log(`Function execution time: ${Date.now() - startTime}ms`);
   ```

2. Track error rates per API source:
   ```typescript
   const errorStats = {
     googleSafeBrowsing: 0,
     abuseIPDB: 0,
     urlhaus: 0,
     domainAge: 0
   };
   localStorage.setItem('api_error_stats', JSON.stringify(errorStats));
   ```

3. Consider adding analytics:
   - Netlify Analytics (built-in, no cookies)
   - Self-hosted Plausible or Umami
   - Only track page views, not user data

**Files to Modify:**
- All Netlify functions
- `src/lib/api.ts`

### 4.5 Security Enhancements

**Priority:** Medium
**Effort:** Low (1-2 hours)
**Impact:** Medium (security)

**Tasks:**
1. Enhance CSP in `netlify.toml`:
   ```toml
   Content-Security-Policy = "default-src 'self'; connect-src 'self' https://urlhaus.abuse.ch; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self'"
   ```

2. Add `public/security.txt`:
   ```
   Contact: security@yourdomain.com
   Expires: 2026-12-31T23:59:59Z
   Preferred-Languages: en
   ```

3. Add privacy policy page:
   - Create simple page explaining data handling
   - All processing is local
   - No tracking or analytics
   - Link from footer

**Files to Create:**
- `public/security.txt`
- `src/routes/privacy.svelte` (if using SvelteKit)

**Files to Modify:**
- `netlify.toml`

---

## Phase 5: Performance Optimizations (P3 - Medium Impact)

**Goal:** Further optimize QR decoding and bundle size.

### 5.1 Smart QR Decoding Strategy Selection

**Priority:** Low
**Effort:** Medium (3-4 hours)
**Impact:** Medium (decode speed)

**Tasks:**
1. Add image analysis to `src/lib/decode.ts`:
   ```typescript
   function analyzeImage(imageData: ImageData): ImageCharacteristics {
     // Analyze brightness and contrast
     // Return { avgBrightness, contrast }
   }

   function selectStrategies(chars: ImageCharacteristics): string[] {
     if (chars.contrast > 0.7 && chars.avgBrightness > 0.3) {
       return ['normal']; // Clear image
     }
     if (chars.avgBrightness < 0.3) {
       return ['inverted', 'enhanced', 'normal']; // Dark
     }
     return ['normal', 'enhanced', 'adaptive', 'flipped', 'inverted'];
   }
   ```

2. Update `decodeQRFromFile()` to use smart selection

**Expected Improvement:** 200-400ms → 50-150ms for clear QR codes

**Files to Modify:**
- `src/lib/decode.ts`

### 5.2 Web Workers for Heavy Computation

**Priority:** Low
**Effort:** High (6-8 hours)
**Impact:** Medium (UI responsiveness)

**Tasks:**
1. Create `src/lib/workers/analysis.worker.ts`:
   ```typescript
   self.onmessage = async (e: MessageEvent) => {
     const { type, payload } = e.data;

     switch (type) {
       case 'decode':
         const result = await decodeQR(payload.imageData);
         self.postMessage({ type: 'decoded', result });
         break;

       case 'analyze-tier1':
         const heuristics = await analyzeTier1(payload.url);
         self.postMessage({ type: 'tier1-complete', heuristics });
         break;
     }
   };
   ```

2. Update `src/App.svelte` to use worker

**Files to Create:**
- `src/lib/workers/analysis.worker.ts`

**Files to Modify:**
- `src/App.svelte`

### 5.3 Bundle Optimization

**Priority:** Low
**Effort:** Low (2-3 hours)
**Impact:** Low (initial load)

**Tasks:**
1. Code-split QR decoding in `vite.config.mts`:
   ```typescript
   build: {
     rollupOptions: {
       output: {
         manualChunks: {
           'qr-decode': ['jsqr'],
           'heuristics': ['./src/lib/heuristics.ts']
         }
       }
     }
   }
   ```

2. Lazy-load camera module:
   ```typescript
   async function startCameraScan() {
     const { initCamera } = await import('./lib/camera');
     // ... camera logic
   }
   ```

3. Preload critical resources in `src/index.html`:
   ```html
   <link rel="preload" href="/shorteners.json" as="fetch" crossorigin>
   <link rel="preload" href="/urlhaus/hosts.json" as="fetch" crossorigin>
   ```

**Files to Modify:**
- `vite.config.mts`
- `src/App.svelte`
- `src/index.html`

---

## Infrastructure & Operations

### Scheduled Netlify Builds

**Goal:** Keep threat intelligence data fresh without GitHub commits.

**Priority:** Medium
**Effort:** Low (30 minutes)
**Impact:** Medium (data freshness)

**Tasks:**
1. Create build hook in Netlify dashboard:
   - Go to Site settings → Build & deploy → Build hooks
   - Create new hook: "Daily data refresh"
   - Copy webhook URL

2. Set up cron service (choose one):

   **Option A: cron-job.org** (Free)
   - Create account at cron-job.org
   - Add new cron job
   - URL: Your Netlify build hook URL
   - Schedule: Daily at 3:00 AM UTC
   - Method: POST

   **Option B: GitHub Actions** (Keep for scheduling only)
   - Modify `.github/workflows/netlify-build.yml`:
   ```yaml
   name: Trigger Netlify Build
   on:
     schedule:
       - cron: "0 3 * * *"  # Daily at 3 AM UTC
     workflow_dispatch:

   jobs:
     trigger:
       runs-on: ubuntu-latest
       steps:
         - name: Trigger Netlify Build
           run: curl -X POST -d {} ${{ secrets.NETLIFY_BUILD_HOOK }}
   ```

   **Option C: Zapier/IFTTT** (No-code)
   - Create daily scheduled zap
   - Action: POST to Netlify build hook

**Recommended:** Option A (cron-job.org) - simplest, no GitHub involvement

---

## Testing & Quality Assurance

### Recommended Testing Before Deployment

**Unit Tests:**
- [ ] Test `analyzeTier1()` returns results <50ms
- [ ] Test `analyzeTier2()` handles cache misses
- [ ] Test `analyzeTier3()` handles API failures
- [ ] Test `checkAllThreatIntel()` with allSettled
- [ ] Test `expandFirstHop()` timeout behavior

**Integration Tests:**
- [ ] Test progressive results update UI correctly
- [ ] Test redirect expansion with various shorteners
- [ ] Test parallel API calls complete successfully
- [ ] Test prebuild script with network failures

**E2E Tests:**
- [ ] Test QR code scan → results flow
- [ ] Test file upload → results flow
- [ ] Test manual URL input → results flow
- [ ] Test progressive loading indicators appear
- [ ] Test redirect chain displays correctly

**Performance Tests:**
- [ ] Measure time to first result (<100ms target)
- [ ] Measure time to complete analysis (<500ms target)
- [ ] Measure prebuild script execution (<500ms target)
- [ ] Measure bundle size (baseline: 235KB gzipped)

---

## Documentation Improvements

### User-Facing Documentation

**Priority:** Low
**Effort:** Low (2-3 hours)
**Impact:** Low (user education)

**Tasks:**
1. Create help/FAQ page:
   - How QRCheck works
   - What each security check means
   - How to interpret results
   - Privacy guarantees

2. Add educational tooltips:
   - Hover over risk indicators
   - Explain threat intelligence sources
   - Clarify redirect chain visualization

3. Improve error messages:
   - More helpful when API fails
   - Suggestions for next steps
   - Clear "try again" actions

**Files to Create:**
- `src/routes/help.svelte`
- `src/components/Tooltip.svelte`

**Files to Modify:**
- `src/App.svelte` (add tooltips)

### Developer Documentation

**Priority:** Medium
**Effort:** Low (1-2 hours)
**Impact:** Medium (maintainability)

**Tasks:**
1. Update README.md:
   - Add performance metrics section
   - Document tiered architecture
   - Add deployment instructions
   - Include troubleshooting guide

2. Create CONTRIBUTING.md:
   - Code style guidelines
   - How to add new heuristics
   - How to add threat intel sources
   - Testing requirements

3. Document API contracts:
   - Netlify Function interfaces
   - Heuristics result formats
   - Progressive result states

**Files to Create:**
- `CONTRIBUTING.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`

**Files to Modify:**
- `README.md`

---

## Quick Wins (Can Do Now)

These are small improvements with high ROI:

1. **Add Loading Text During Analysis** (5 minutes)
   - Update analysis progress messages
   - Show which tier is currently running
   - Display estimated time remaining

2. **Improve Error Messages** (15 minutes)
   - Replace generic "failed" with specific errors
   - Add retry buttons
   - Show which API failed specifically

3. **Add Keyboard Shortcuts** (30 minutes)
   - Escape to close results
   - Ctrl+V to paste URL
   - Space to scan new QR

4. **Add Share Results Button** (30 minutes)
   - Copy results to clipboard
   - Share verdict (not URL for privacy)
   - Export as screenshot

5. **Add Dark Mode Toggle** (1 hour)
   - System preference detection
   - Manual toggle
   - Persist preference

---

## Long-Term Vision

### Future Enhancements (P4+)

**Advanced Analysis:**
- Machine learning for phishing detection
- SSL certificate validation
- WHOIS data enrichment
- Historical URL reputation

**Integration Options:**
- Browser extension
- Mobile app (React Native)
- API service for other apps
- Slack/Discord bot integration

**Community Features:**
- User-submitted threat reports
- Community ratings
- Threat feed subscriptions
- Integration with other threat intel platforms

**Enterprise Features:**
- Bulk URL scanning
- API rate limiting tiers
- Custom threat intelligence sources
- Audit logging
- SSO integration

---

## Immediate Priority Ranking

**This Week:**
1. Fix redirect expansion (DONE ✅)
2. Create ResultsCard component (Phase 2.1)
3. Set up scheduled builds (Infrastructure)

**This Month:**
1. Complete Phase 2 (Results UI)
2. Implement Phase 4.1-4.2 (Caching & Error Handling)
3. Add monitoring (Phase 4.4)

**This Quarter:**
1. Complete Phase 4 (Production Hardening)
2. Implement Phase 5.1 (Smart QR Decoding)
3. Improve documentation

**Nice to Have:**
- Phase 5.2 (Web Workers)
- Phase 5.3 (Bundle Optimization)
- Advanced features

---

## Success Metrics to Track

**Performance:**
- Time to first result (target: <100ms)
- Time to complete analysis (target: <500ms)
- Prebuild script time (target: <500ms)
- Bundle size (target: <250KB gzipped)

**Reliability:**
- API error rate (target: <5%)
- Build success rate (target: >99%)
- Cache hit rate (target: >80%)

**User Experience:**
- Bounce rate on error
- Scan completion rate
- Time spent viewing results
- Return visitor rate

**Quality:**
- TypeScript compilation time
- Test coverage (target: >80%)
- Code review coverage
- Documentation completeness

---

## Resources & References

**Documentation:**
- [Tiered Heuristics Architecture](src/lib/heuristics-tiered.ts)
- [Parallel API Implementation](src/lib/api.ts)
- [Build Script](scripts/prebuild.mjs)
- [Performance Results](PERFORMANCE_IMPROVEMENTS.md)

**External Dependencies:**
- URLHaus API: https://urlhaus.abuse.ch/api/
- Shortener Lists:
  - https://github.com/korlabsio/urlshortener
  - https://github.com/PeterDaveHello/url-shorteners

**Tools:**
- Netlify: Hosting & Functions
- Vite: Build tool
- Svelte: Frontend framework
- TypeScript: Type safety

---

**Last Updated:** December 16, 2025
**Status:** ✅ P0 Complete, P1-P3 Planned
**Next Action:** Fix redirect expansion → Create ResultsCard component
