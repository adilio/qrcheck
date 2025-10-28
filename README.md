# <img src="public/qrcheck.png" alt="qrcheck-logo" style="width:25px;"/> QRCheck.ca

**A privacy-focused tool to check QR codes and URLs before you visit them.**

Ever wondered where that QR code at the coffee shop is really taking you? Or if that shortened link in your email is actually safe? QRCheck helps you find out—without compromising your privacy.

## Why QRCheck?

QR codes are everywhere: restaurant menus, parking meters, event flyers, even on billboards. They're convenient, but they're also a security risk. You can't see where they lead until it's too late.

I built QRCheck because I wanted a simple way to check links and QR codes before clicking on them. No sign-ups, no tracking, no sending your data to random servers. Just point, scan, and get an honest answer about what you're dealing with.

## What It Does

QRCheck gives you X-ray vision for QR codes and URLs. Here's what happens when you scan:

### 🔍 Decodes QR Codes
- Scan with your camera or upload an image
- Works with all content types: URLs, text, emails, phone numbers, WiFi credentials, contact cards, and locations
- Everything happens locally in your browser

### 🧪 Analyzes URLs
- Detects 200+ URL shortening services that hide the real destination
- Follows redirect chains to reveal where you'll actually end up
- Spots suspicious patterns, sketchy domains, and common attack techniques
- Checks against threat intelligence databases (optional)

### 📊 Gives You a Risk Score
- **Low Risk (0-39)**: Looks clean, no red flags
- **Medium Risk (40-69)**: Some concerns, proceed with caution
- **High Risk (70+)**: Multiple warning signs, avoid this URL

You get a clear breakdown of what was found and why it matters.

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

### Threat Intelligence (Optional)
When enabled, QRCheck can check URLs against external security databases:

- ✅ **Google Safe Browsing** — Detects malware, phishing, social engineering, and unwanted software
- ✅ **AbuseIPDB** — Identifies known malicious IP addresses and hostile infrastructure
- ✅ **URLHaus** — Catches known malware distribution URLs (updated daily)
- ✅ **Pattern Analysis** — Built-in fallback using local pattern matching

*Note: Threat intelligence is optional and requires API keys. The tool works great without it.*

## Privacy First

Your privacy matters. Here's what QRCheck does differently:

- **Local Processing** — QR decoding and most analysis happens entirely in your browser
- **No Tracking** — We don't use analytics, cookies, or any tracking
- **No Storage** — URLs you check aren't saved anywhere
- **No Data Sharing** — Nothing is sent to third parties
- **Open Source** — All code is public and auditable
- **Secure API Calls** — When threat intelligence is enabled, lookups go through secure Netlify Functions

**Data flow**: QR Code → Your Browser (decoding) → Your Browser (analysis) → Netlify Functions (optional threat checks) → Your Browser (results). That's it. Nothing is logged or stored.

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Quick Start

```bash
# Clone the repository
git clone https://github.com/adilio/qrcheck.git
cd qrcheck

# Install dependencies
npm install

# Start with full features (recommended)
npm run dev:netlify
```

Visit `http://localhost:8888` and you're ready to go!

### Development Commands

```bash
# Run tests
npm run test

# Run end-to-end tests
npm run e2e

# Build for production
npm run build

# Full verification (typecheck, lint, test, e2e, build)
npm run ci:verify
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

### Project Structure

```
src/lib/decode.ts      — QR code decoding and content parsing
src/lib/heuristics.ts  — Heuristic analysis engine
src/lib/shortener.ts   — URL shortener detection
src/lib/api.ts         — Netlify Function integration
src/lib/camera.ts      — Camera handling
src/App.svelte         — Main application
functions/             — Netlify Functions (server-side)
netlify.toml           — Netlify configuration
```

## Troubleshooting

### Google Safe Browsing isn't working
- Make sure `GSB_API_KEY` is set in Netlify environment variables
- Verify the Safe Browsing API is enabled in Google Cloud Console
- Check that your API key isn't restricted too tightly

### Environment variables not loading
- **Local**: Ensure `.env` file exists and is formatted correctly
- **Netlify**: Double-check the variables in your dashboard
- **Debug**: Look at Netlify function logs for clues

### Functions returning 404
- Verify functions are in the `functions/` directory
- Check `netlify.toml` configuration
- Look for build errors in Netlify deploy logs

### Slow performance
- External APIs (Google Safe Browsing, AbuseIPDB) add ~200-500ms latency
- First function call may be slow (cold start)
- This is expected behavior for threat intelligence lookups

## License

MIT License — see [LICENSE](LICENSE) for details.

---

**Have questions or feedback?** Open an issue on GitHub or submit a pull request. Stay safe out there! 🛡️