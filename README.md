# <img src="public/qrcheck.png" alt="qrcheck-logo" style="width:25px;"/> QRCheck.ca

**A privacy-focused, real-time security analyzer for QR codes and URLs.**

Ever wondered where that QR code at the coffee shop is really taking you? Or if that shortened link in your email is actually safe? QRCheck provides instant security analysis—without compromising your privacy.

Built with a progressive, tiered analysis system that delivers instant feedback while optionally checking against live threat intelligence databases.

## Why QRCheck?

QR codes are everywhere: restaurant menus, parking meters, event flyers, even on billboards. They're convenient, but they're also a security risk. You can't see where they lead until it's too late.

I built QRCheck because I wanted a simple way to check links and QR codes before clicking on them. No sign-ups, no tracking, no sending your data to random servers. Just point, scan, and get an honest answer about what you're dealing with.

## What It Does

QRCheck gives you X-ray vision for QR codes and URLs with real-time, progressive analysis:

### 🔍 Decodes QR Codes Locally
- Scan with your camera, upload an image, or paste a QR screenshot from your clipboard
- Works with all content types: URLs, text, emails, phone numbers, WiFi credentials, contact cards, and locations
- Everything happens locally in your browser—zero server round-trips
- Uses jsQR library for fast, accurate decoding

### ⚡ Progressive Tiered Analysis
QRCheck uses a three-tier analysis system that delivers instant feedback:

**Tier 1: Instant Client-Side Checks (<50ms)**
- URL parsing and protocol validation
- Suspicious TLD detection (25 high-risk extensions)
- Keyword detection (phishing, financial, urgent language)
- URL shortener identification (200+ known services)
- Typosquatting detection (brand similarity matching)
- Homograph attack detection (look-alike Unicode characters)
- Obfuscation pattern detection (base64, hex encoding)

**Tier 2: Fast Network Checks (100-300ms)**
- URLHaus malware database lookup (updated daily)
- Domain age verification via RDAP

**Tier 3: Deep Threat Intelligence (200-500ms, optional)**
- Google Safe Browsing API (malware, phishing, unwanted software)
- AbuseIPDB IP reputation checks

### 🔗 URL Expansion & Redirect Tracing
- Detects 200+ URL shortening services that hide the real destination
- Follows complete redirect chains to reveal where you'll actually end up
- Shows every hop in the chain with visual tree structure
- Caches results in IndexedDB for 24 hours (faster repeat checks)
- Handles CORS, timeouts, and redirect loops gracefully

### 📊 Clear Risk Assessment
- **Low Risk (0-39)**: Looks clean, no red flags
- **Medium Risk (40-69)**: Some concerns, proceed with caution
- **High Risk (70+)**: Multiple warning signs, avoid this URL

### 🎯 Transparent Analysis Details
- Analysis details expand automatically after checks complete
- See exactly which checks passed, warned, or failed
- Educational tooltips explain what each check does and why it matters
- Step-by-step progress with execution timing for each check

## Security Checks

Here's exactly what QRCheck looks for when analyzing a URL:

### URL Structure
- ✅ **URL Length** — Flags URLs over 2,000 characters (often used to hide malicious code)
- ✅ **Obfuscation Detection** — Spots excessive encoding, base64, or hex that could hide the true destination
- ✅ **Dangerous Protocols** — Warns about `javascript:`, `data:`, `file:`, or `ftp:` schemes
- ✅ **HTTPS Check** — Flags URLs that don't use secure HTTPS connections
- ✅ **Executable Files** — Detects links to `.exe`, `.msi`, `.apk`, `.dmg`, and other potentially dangerous files
- ✅ **Suspicious Archives** — Flags `.zip`, `.rar`, `.7z` files, especially when combined with urgent keywords

### Domain Analysis
- ✅ **IP-Based URLs** — Detects raw IP addresses instead of proper domain names (common in phishing)
- ✅ **Risky TLDs** — Flags domains using high-abuse extensions like `.tk`, `.ml`, `.ga`, `.cf`
- ✅ **Punycode/IDN** — Identifies internationalized domain names that could be used for spoofing
- ✅ **Domain Age** — Checks if the domain was just registered (newer domains = higher risk)
- ✅ **Typosquatting** — Detects domains that look like popular brands (e.g., "g00gle.com" instead of "google.com")
- ✅ **Homograph Attacks** — Spots look-alike characters from different alphabets (e.g., "а" vs "a")

### Content Analysis
- ✅ **Suspicious Keywords** — Looks for alarming words in five categories:
  - **Account terms**: login, signin, verify, password, secure, suspended, locked
  - **Urgent language**: urgent, immediate, action-required, expires, limited-time
  - **Financial terms**: paypal, bank, invoice, payment, transfer, account
  - **Download prompts**: download, install, execute, run, update
  - **Threat language**: virus, malware, infected, compromised, alert, warning

### URL Shorteners
- ✅ **Known Shorteners** — Identifies 200+ services including bit.ly, tinyurl.com, t.co, cutt.ly, and many more
- ✅ **Risk-Based Scoring** — Assigns different risk levels based on service reputation:
  - Reputable services (bit.ly, t.co): Medium concern
  - Lesser-known services: Higher concern
  - Commonly abused services: High concern

### Redirect Chain Analysis
- ✅ **Redirect Following** — Traces the full path from shortened URL to final destination
- ✅ **Hop Counting** — Flags excessive redirects (each hop adds to the risk score)
- ✅ **Chain Transparency** — Shows you every stop along the way

### Threat Intelligence (Tier 2 & 3)
QRCheck integrates multiple threat intelligence sources with smart fallbacks:

**Tier 2 (Always Available, No API Keys):**
- ✅ **URLHaus** — Catches known malware distribution URLs from abuse.ch (updated daily at build time)
- ✅ **Domain Age via RDAP** — Flags newly registered domains (free, public service)
- ✅ **Pattern Analysis** — Built-in heuristics using local pattern matching

**Tier 3 (Optional, Requires API Keys):**
- ✅ **Google Safe Browsing** — Detects malware, phishing, social engineering, and unwanted software
- ✅ **AbuseIPDB** — Identifies known malicious IP addresses and hostile infrastructure

*Note: Tier 3 is optional. The tool provides comprehensive analysis with Tier 1 & 2 checks alone.*

## Progressive Web App (PWA)

QRCheck is a full Progressive Web App—install it on your device for an app-like experience:

### Features
- **Install to Home Screen** — Add QRCheck to your phone or desktop for quick access
- **Offline Support** — Tier 1 + Tier 2 checks work without internet connection
- **Share Target** — Share URLs from other apps directly to QRCheck (Android/Chrome)
- **App Shortcuts** — Quick actions from home screen icon
- **Auto-Updates** — Get notified when a new version is available

### How to Install
- **Android/Chrome**: Tap the install prompt after your first scan, or use browser menu → "Add to Home Screen"
- **iOS Safari**: Tap Share → "Add to Home Screen"
- **Desktop Chrome/Edge**: Click install icon in address bar

### Offline Capabilities
When offline, QRCheck still provides comprehensive analysis:
- **Tier 1 (Always Available)**: URL parsing, TLD checks, keyword detection, typosquatting, homograph detection
- **Tier 2 (Cached)**: URLHaus data and shortener detection from last sync
- **Tier 3 (Online Only)**: Google Safe Browsing, AbuseIPDB require network

## Privacy First

Your privacy matters. No tracking or user data collected.

Here's what QRCheck does differently:

- **Local Processing** — QR decoding and Tier 1 analysis happens entirely in your browser
- **Zero Tracking** — No analytics, no cookies, no fingerprinting, no logging
- **Zero Storage** — URLs you check aren't saved on our servers
- **Zero Data Sharing** — Nothing is sent to third parties without your explicit consent
- **Open Source** — All code is public and auditable on GitHub
- **Secure API Calls** — Tier 2 & 3 checks go through isolated Netlify Functions with rate limiting
- **Content Security Policy** — Strict CSP headers prevent injection attacks and enforce security boundaries
- **SSRF Protection** — Functions block private IP ranges to prevent internal network attacks

**Data flow**:
```
QR Code → Your Browser (decoding + Tier 1 analysis, <50ms)
         → Netlify Functions (Tier 2 checks, 100-300ms)
         → Optional: Tier 3 APIs (if keys configured, 200-500ms)
         → Your Browser (results display)
```

Nothing is logged or stored. Threat intelligence lookups are anonymous—APIs never see your IP or identity, only the URL being checked.

## Getting Started

### Prerequisites
- Node.js 18+
- npm or your preferred package manager

### Quick Start

```bash
# Clone the repository
git clone https://github.com/adilio/qrcheck.git
cd qrcheck

# Install dependencies
npm install

# Start development server with Netlify Functions (recommended)
npm run dev:netlify
```

Visit `http://localhost:8888` and you're ready to go!

The dev server includes:
- Hot module replacement (HMR) for instant updates
- Local Netlify Functions runtime on port 8888
- Vite dev server on port 5173 (proxied through Netlify)
- Auto-reloading on file changes

### Alternative: Frontend-Only Development

```bash
# Start Vite dev server only (no backend functions)
npm run dev
```

Visit `http://localhost:5173` — Tier 1 checks work, but Tier 2/3 will fail without functions.

### Development Commands

```bash
# Development
npm run dev              # Vite dev server only (port 5173)
npm run dev:netlify      # Full stack with Netlify Functions (port 8888, recommended)

# Testing
npm run test             # Unit tests with Vitest
npm run e2e              # End-to-end tests with Playwright

# Code Quality
npm run typecheck        # TypeScript type checking
npm run lint             # ESLint code linting

# Build
npm run prebuild         # Fetch fresh URLHaus & shortener data
npm run build            # Production build (runs prebuild automatically)
npm run preview          # Preview production build locally

# CI Pipeline
npm run ci:verify        # Full verification: typecheck → lint → test → e2e → build
```

### Project Structure

```
qrcheck/
├── src/
│   ├── App.svelte                  # Main application component
│   ├── main.ts                     # Application entry point
│   ├── types.ts                    # TypeScript type definitions
│   ├── components/
│   │   ├── ResultsCard.svelte      # Progressive results display
│   │   ├── OfflineIndicator.svelte # Offline mode banner
│   │   ├── UpdatePrompt.svelte     # PWA update notification
│   │   └── InstallPrompt.svelte    # PWA install prompt
│   ├── lib/
│   │   ├── decode.ts               # QR code decoding & content parsing
│   │   ├── heuristics.ts           # Main heuristic analysis engine
│   │   ├── heuristics-tiered.ts    # Progressive tiered analysis
│   │   ├── shortener.ts            # URL shortener detection
│   │   ├── expand.ts               # Redirect chain expansion
│   │   ├── cache.ts                # IndexedDB caching layer
│   │   ├── camera.ts               # Camera access & QR scanning
│   │   ├── api.ts                  # Netlify Function integration
│   │   ├── pwa.ts                  # Service worker registration
│   │   ├── network-status.ts       # Online/offline detection
│   │   ├── install-prompt.ts       # PWA install prompt logic
│   │   └── share-handler.ts        # Share target handler
│   └── data/
│       ├── tlds_suspicious.ts      # Suspicious TLD list
│       └── keywords.ts             # Phishing keyword patterns
├── functions/                      # Netlify serverless functions
│   ├── resolve.ts                  # URL redirect resolution
│   ├── check-threat-intel.ts       # Threat intelligence aggregation
│   ├── check-domain-age.ts         # Domain age via RDAP
│   └── intel-urlhaus.ts            # URLHaus malware database
├── public/
│   ├── shorteners.json             # 200+ URL shortener domains (generated)
│   ├── icons/                      # PWA icon suite
│   └── urlhaus/
│       └── hosts.json              # Malicious host list (generated)
├── scripts/
│   └── prebuild.mjs                # Fetches fresh threat data before build
├── tests/
│   ├── unit/                       # Vitest unit tests
│   └── e2e/                        # Playwright end-to-end tests
├── netlify.toml                    # Netlify config (functions, headers, redirects)
├── vite.config.mts                 # Vite build configuration
└── playwright.config.ts            # Playwright test configuration
```

## Optional: Threat Intelligence Setup

Want even stronger protection? You can enable Google Safe Browsing (recommended) or AbuseIPDB.

### Google Safe Browsing

1. **Get an API key**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a project or select an existing one
   - Enable the Safe Browsing API
   - Create an API key under "Credentials"

2. **Add to your environment**:

   For local development:
   ```bash
   cp .env.example .env
   # Edit .env and add:
   GSB_API_KEY=your_api_key_here
   ```

   For Netlify deployment:
   - Go to Site Settings → Environment Variables
   - Add `GSB_API_KEY` with your API key

### AbuseIPDB (Optional)

Similar setup for IP reputation checking:
```bash
ABUSEIPDB_API_KEY=your_abuseipdb_key_here
```

## Deploy to Netlify

1. Push your code to GitHub
2. Connect your repository to Netlify
3. Add environment variables (if using threat intelligence)
4. Deploy!

Netlify will handle the build and deployment automatically.

## Contributing

Want to help make QRCheck better? Contributions are welcome!

### How to Contribute

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Add tests for new functionality
5. Run verification: `npm run ci:verify`
6. Submit a pull request

### Ideas for Contributions

- New security checks or threat feeds
- UI/UX improvements
- Performance optimizations
- Better documentation
- Bug fixes

### Understanding the Analysis Flow

```
1. User Action
   └─ Scan QR code / Upload image / Paste URL

2. QR Decoding (Local, ~10ms)
   └─ jsQR library extracts URL from image
   └─ Content type detection (URL, email, WiFi, etc.)

3. Tier 1: Instant Analysis (<50ms, Local)
   ├─ URL parsing & validation
   ├─ Protocol check (HTTP/HTTPS/dangerous schemes)
   ├─ Suspicious TLD detection
   ├─ Keyword pattern matching (phishing indicators)
   ├─ URL shortener identification
   ├─ Typosquatting & homograph detection
   └─ Obfuscation detection
   └─ UI updates immediately with "Quick Checks" results

4. Tier 2: Network Intelligence (100-300ms)
   ├─ URLHaus malware database query (Netlify Function)
   ├─ Domain age check via RDAP (Netlify Function)
   └─ UI updates with "Cached Intelligence" results

5. Tier 3: Deep Threat Intel (200-500ms, Optional)
   ├─ Google Safe Browsing API (if key configured)
   ├─ AbuseIPDB reputation check (if key configured)
   └─ UI updates with "Threat Intelligence" results

6. Final Results
   ├─ Risk score aggregation (0-100)
   ├─ Verdict determination (safe/caution/danger)
   ├─ Redirect chain visualization
   ├─ Detailed analysis breakdown (expands by default)
   └─ Educational tooltips for each finding
```

## Troubleshooting

### Common Issues

**Tier 1 checks work, but Tier 2/3 fail locally**
- Make sure you're running `npm run dev:netlify` (not just `npm run dev`)
- Verify Netlify CLI is installed: `npx netlify --version`
- Check that functions built successfully (look for `functions/` in terminal output)

**Google Safe Browsing isn't working**
- Ensure `GSB_API_KEY` is set in Netlify environment variables (Site Settings → Environment Variables)
- Verify the Safe Browsing API is enabled in Google Cloud Console
- Check that your API key isn't IP-restricted (Netlify Functions use dynamic IPs)
- Look at Function logs in Netlify dashboard for specific error messages

**Environment variables not loading**
- **Local**: Ensure `.env` file exists in project root and is formatted correctly (`KEY=value`, no quotes)
- **Netlify**: Variables in dashboard must exactly match function code (case-sensitive)
- **Debug**: Add `console.log(process.env.GSB_API_KEY ? 'Key present' : 'Key missing')` to function
- **Note**: Frontend env vars must start with `VITE_` to be accessible in browser code

**Functions returning 404**
- Verify functions are in the `functions/` directory (not `netlify/functions/`)
- Check `netlify.toml` configuration: `functions = "functions"`
- Run `npm run build` and check for compilation errors in function files
- Look for build errors in Netlify deploy logs (Functions tab)

**URLHaus checks showing "Feed Error"**
- URLHaus occasionally returns UA verification challenges (307 redirects)
- The function should handle these gracefully and show "no results" instead of errors
- If persistent, check [URLHaus status](https://urlhaus.abuse.ch/) or function logs

**Prebuild script fails**
- The `prebuild.mjs` script fetches fresh URLHaus and shortener data before each build
- If it fails, check your internet connection or CDN availability
- Temporary failures won't break the app—previous cached data in `public/` will be used
- Manual fix: Run `node scripts/prebuild.mjs` to diagnose the issue

**CSP violations in console**
- Recent commits removed all Svelte transitions to prevent CSP violations
- If you see CSP errors, check that you're using the latest version
- CSP header in `netlify.toml` must match the meta tag in `index.html`

**Analysis stuck on "Analyzing..." or incomplete results**
- This was a Svelte reactivity issue fixed in recent commits
- Make sure you're using the latest version with keyed `{#each}` blocks
- Check browser console for JavaScript errors
- Try clearing IndexedDB cache (Dev Tools → Application → IndexedDB → Delete)

**Camera not working**
- HTTPS is required for camera access (localhost is exempt)
- Check browser permissions (may need to explicitly allow camera)
- Some browsers block camera on insecure origins
- Safari requires user interaction before camera access

**Slow performance**
- **Expected**: Tier 2 adds 100-300ms, Tier 3 adds 200-500ms
- **Cold starts**: First Netlify Function call may take 1-3 seconds
- **Optimization**: Results are cached in IndexedDB for 24 hours
- **Trade-off**: Accuracy vs speed—instant checks in Tier 1, deep checks later

### Performance Benchmarks

Typical analysis times on a modern connection:

| Tier | Duration | Components |
|------|----------|------------|
| Tier 1 | 20-50ms | Pure JavaScript, runs in browser |
| Tier 2 | +100-300ms | Netlify Functions (URLHaus, RDAP) |
| Tier 3 | +200-500ms | External APIs (Google, AbuseIPDB) |
| **Total** | **320-850ms** | **Complete analysis with all tiers** |

Cold start (first request): Add 1-3 seconds for Netlify Function initialization.

## Technology Stack

QRCheck is built with modern web technologies for performance, security, and maintainability:

### Frontend
- **[Svelte 4](https://svelte.dev/)** — Reactive UI framework with compile-time optimization
- **[Vite 5](https://vitejs.dev/)** — Lightning-fast build tool with HMR
- **[TypeScript 5](https://www.typescriptlang.org/)** — Type-safe JavaScript
- **[jsQR](https://github.com/cozmo/jsQR)** — Pure JavaScript QR code decoder
- **IndexedDB** — Client-side caching with 24-hour TTL

### Backend (Serverless)
- **[Netlify Functions](https://docs.netlify.com/functions/overview/)** — Serverless compute (AWS Lambda)
- **[Node.js 18+](https://nodejs.org/)** — JavaScript runtime
- **[Undici](https://undici.nodejs.org/)** — High-performance HTTP client
- **TypeScript** — Type-safe function code

### Testing & Quality
- **[Vitest](https://vitest.dev/)** — Unit testing framework (Vite-native)
- **[Playwright](https://playwright.dev/)** — End-to-end browser testing
- **[ESLint](https://eslint.org/)** — Code linting with TypeScript rules
- **TypeScript Compiler** — Strict type checking

### Security
- **Content Security Policy (CSP)** — Strict headers prevent XSS and injection attacks
- **SSRF Protection** — Functions block private IP ranges
- **Rate Limiting** — 10 requests per 60 seconds per IP on URL resolution
- **No Analytics** — Zero tracking, zero cookies, zero fingerprinting

### Deployment & Hosting
- **[Netlify](https://www.netlify.com/)** — Edge hosting with automatic SSL
- **GitHub Actions** — CI/CD pipeline (optional)
- **Domain**: Custom domain with HTTPS enforced

### Third-Party Services (Optional)
- **[Google Safe Browsing API](https://developers.google.com/safe-browsing)** — Threat detection
- **[AbuseIPDB](https://www.abuseipdb.com/)** — IP reputation
- **[URLHaus (abuse.ch)](https://urlhaus.abuse.ch/)** — Malware URL database (free, no API key)
- **RDAP** — Domain age verification (free, public service)

## Recent Improvements

Notable enhancements from the last 20 commits:

### Progressive Web App (December 2024)
- ✅ **Full PWA implementation** — Install to home screen, offline support, share target
- ✅ **Service worker with Workbox** — Smart caching strategies for threat data and API responses
- ✅ **Install prompt** — Shows after first successful scan
- ✅ **Offline mode** — Tier 1 + Tier 2 checks work without internet
- ✅ **Share target** — Receive URLs from other apps directly
- ✅ **Update notifications** — Users notified when new version available

### UX & Transparency
- ✅ **Auto-expanded analysis details** — Users see full breakdown without extra clicks
- ✅ **Enhanced footer privacy messaging** — Clear, centered two-line statement
- ✅ **Final destination display** — Visual redirect chain tree shows where shortened URLs lead
- ✅ **Progressive loading states** — Real-time updates as each tier completes
- ✅ **Educational tooltips** — Explains what each check does and why it matters

### Performance & Reliability
- ✅ **Fixed Svelte reactivity issues** — Tier 3 checks now update correctly with keyed `{#each}` blocks
- ✅ **Removed all transitions to prevent CSP crashes** — Eliminated `TypeError: Cannot read properties of null (reading insertRule)`
- ✅ **URLHaus UA challenge handling** — Gracefully handles 307 verify-ua redirects
- ✅ **Aligned CSP headers** — `style-src 'unsafe-inline'` matches between `netlify.toml` and `index.html`
- ✅ **Fixed inline script CSP hash** — Cache-busting script now allowed with SHA-256 hash

### Analysis Engine
- ✅ **Switched to RDAP for domain age** — Replaced failing whoisjson with public RDAP service
- ✅ **URLHaus function path fix** — Corrected endpoint from `/api/intel/urlhaus` to `/.netlify/functions/intel-urlhaus`
- ✅ **Improved URLHaus reliability** — Browser-like UA avoids verification challenges
- ✅ **Better error handling** — Tier 2/3 failures don't block Tier 1 results

### Code Quality
- ✅ **Removed Cloudflare Analytics beacon** — Eliminated CSP violations and console noise
- ✅ **Cleaned up legacy UI** — Deleted duplicate result displays, drawers, and unused components
- ✅ **Simplified state management** — Single `ResultsCard` component for all results
- ✅ **Fixed manifest icon size** — Corrected 512x512 → 96x96 mismatch
- ✅ **Improved scroll targeting** — Correctly scrolls to `.results-card` instead of removed elements

### Build & Deployment
- ✅ **Prebuild data refresh** — Fetches latest URLHaus and shortener data before each build
- ✅ **Fixed Svelte flow block closure** — Resolved `{#if}/{:else if}` parsing errors blocking Netlify builds

## Architecture Decisions

### Why Progressive Tiered Analysis?

Traditional security tools wait for all checks before showing results. QRCheck delivers instant feedback:

1. **Instant Gratification** — Users see results in <50ms, not 500ms+
2. **Perceived Performance** — UI feels instant even while deep checks run
3. **Graceful Degradation** — If Tier 3 APIs fail, users still get comprehensive Tier 1+2 analysis
4. **Cost Optimization** — Expensive API calls (Tier 3) only run after free checks (Tier 1+2) complete
5. **Educational** — Users learn what each tier checks and why it matters

### Why Netlify Functions?

- **Privacy Barrier** — User IP never reaches external APIs (Google, AbuseIPDB)
- **Security** — SSRF protection, rate limiting, input validation
- **Simplicity** — No server management, auto-scaling, zero DevOps
- **Cost-Effective** — 125k requests/month free tier is plenty for most users
- **Performance** — Edge deployment reduces latency

### Why No Backend Database?

- **Privacy** — Nothing to hack if there's nothing to store
- **Compliance** — No GDPR/CCPA concerns when you don't collect data
- **Simplicity** — No database migrations, backups, or scaling issues
- **Cost** — Zero database hosting costs
- **Trust** — Users can verify in browser DevTools that nothing is sent

### Why IndexedDB Caching?

- **Speed** — Repeat checks of same URL return instantly
- **Privacy** — Cache stays in user's browser, never sent anywhere
- **Offline-Capable** — Results available without network (within 24h TTL)
- **Bandwidth** — Reduces unnecessary API calls to threat intelligence services

## Contributing to QRCheck

### Getting Started with Development

1. **Fork & Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/qrcheck.git
   cd qrcheck
   npm install
   ```

2. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Changes & Test**
   ```bash
   npm run dev:netlify    # Start dev server
   npm run test           # Run unit tests
   npm run e2e            # Run e2e tests (requires dev server running)
   npm run ci:verify      # Full verification before commit
   ```

4. **Commit with Conventional Commits**
   ```bash
   git commit -m "feat: add dark mode toggle"
   git commit -m "fix: handle URLHaus UA verification"
   git commit -m "docs: update README with new features"
   ```

5. **Push & Create PR**
   ```bash
   git push origin feature/your-feature-name
   # Open PR on GitHub
   ```

### Contribution Guidelines

- **Code Style**: Follow existing patterns, use TypeScript strictly
- **Testing**: Add tests for new features, ensure all tests pass
- **Commits**: Use [Conventional Commits](https://www.conventionalcommits.org/) format
- **PRs**: Clear description of what/why, reference issues if applicable
- **No Breaking Changes**: Maintain backward compatibility unless discussed

### Ideas for Contributions

**Security & Analysis**
- Add new heuristic checks (e.g., detect homograph attacks better)
- Integrate additional threat intelligence sources
- Improve typosquatting detection with ML
- Add support for more QR content types (vCard, SMS, etc.)

**Performance**
- Optimize Tier 1 checks to run even faster
- Add request deduplication for concurrent scans

**UX & Accessibility**
- Improve mobile scanning experience
- Add keyboard shortcuts
- Enhance screen reader support
- Add internationalization (i18n) for multiple languages

**Testing & Quality**
- Increase test coverage (currently focused on core logic)
- Add visual regression tests
- Create performance benchmarks
- Add integration tests for Netlify Functions

**Documentation**
- Add JSDoc comments to complex functions
- Create video tutorials or GIFs
- Write blog posts about security patterns detected
- Document threat intelligence API setup guides

## Security & Responsible Disclosure

QRCheck is a security tool designed to protect users. If you discover a security vulnerability:

1. **Do NOT open a public issue**
2. Email details to: [your-email@example.com] (replace with actual contact)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if you have one)

We'll respond within 48 hours and work with you to address the issue.

## Roadmap

Future enhancements under consideration:

- [x] Progressive Web App with offline support
- [ ] Browser extension (Chrome, Firefox, Safari)
- [ ] Mobile apps (iOS, Android) with native camera
- [ ] Bulk URL scanning from CSV/text file
- [ ] Historical tracking of scanned URLs (opt-in, client-side only)
- [ ] API endpoint for programmatic access
- [ ] Integration with password managers (1Password, Bitwarden)
- [ ] Webhook support for security teams
- [ ] Custom threat intelligence feeds
- [ ] Machine learning for advanced pattern detection
- [ ] Rate limit API for anonymous public use

## License

MIT License — see [LICENSE](LICENSE) for details.

---

**Have questions or feedback?** Open an issue on GitHub or submit a pull request. Stay safe out there! 🛡️
