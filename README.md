# QRCheck 🛡️

A privacy-focused tool for checking QR codes and URLs before you visit them.

QRCheck helps you stay safe online by analyzing QR codes and checking URLs for potential threats like malware, phishing, and other security risks. Everything happens locally in your browser, and no data is sent to external servers.

## Why I Built This

I created QRCheck because I wanted a simple, privacy-first way to check QR codes and links before clicking on them. Whether you're scanning a QR code from a restaurant menu, checking a link in an email, or just being careful online, this tool provides some extra peace of mind.

## Features

- **Privacy First**: All analysis happens in your browser
- **URL Shortener Detection**: Identifies shortened links that hide the true destination
- **Heuristic Analysis**: Detects suspicious patterns in URLs
- **Threat Intelligence**: Optional integration with security databases
- **Camera Support**: Scan QR codes directly from your device
- **Open Source**: Everything is transparent and auditable

## What It Does

**QR Code Support**
- Decode any QR code locally
- Recognize different content types (URLs, text, emails, phone numbers, WiFi, contact cards, locations)
- Scan via camera or upload an image

**URL Analysis**
- Detect URL shorteners (200+ services)
- Find suspicious patterns and red flags
- Follow redirects to see where links actually go
- Check against threat databases (optional)

**Risk Assessment**
- 0-100 risk scoring system
- Clear categories: Low, Medium, High Risk
- Detailed explanations of detected issues

## How It Works

1. **Decode** - Extract the raw data from QR codes
2. **Analyze** - Run heuristic analysis to detect suspicious patterns
3. **Verify** - Optionally check against threat intelligence feeds
4. **Report** - Get a clear risk assessment with detailed findings

All processing happens locally in your browser, so your data stays private.

## URL Shortener Detection

QRCheck includes a database of URL shortening services. This matters because:

- Shortened URLs obscure the true destination
- They can bypass security filters
- Attackers often use them to hide malicious sites

The tool checks against 200+ known shortening services including popular ones (bit.ly, tinyurl.com, t.co), niche services, and commonly abused domains.

## Risk Assessment

QRCheck provides a 0-100 risk score with three levels:

- **Low Risk (0-39)**: No obvious red flags detected
- **Medium Risk (40-69)**: Some suspicious patterns detected
- **High Risk (70+)**: Multiple risk factors or highly suspicious patterns

## Security Checks Performed

QRCheck performs multiple security checks on URLs. Here's exactly what gets analyzed:

### Local Browser Checks

**URL Structure Analysis**
- **URL Length**: Flags URLs over 2000 characters (+20 points)
- **URL Obfuscation**: Detects excessive encoding, base64, hex encoding (+40 points)
- **Dangerous Schemes**: Checks for data:, file:, ftp:, javascript: protocols (+50 points)
- **HTTPS Usage**: Ensures secure connection (+15 points if missing)

**Domain Analysis**
- **IP-based URLs**: Detects URLs using IP addresses instead of domains (+35 points)
- **Suspicious TLDs**: Flags risky top-level domains (.tk, .ml, .ga, .cf, etc.) (+25 points)
- **Punycode/IDN**: Detects internationalized domain names (+10 points)
- **New Domains**: Identifies newly registered domains (+15 points)
- **Domain Age**: Checks domain registration age via external API (+15-30 points)

**Content Analysis**
- **Suspicious Keywords**: Detects alarming words in categories:
  - Account terms: login, signin, verify, password, secure, etc.
  - Urgent terms: urgent, immediate, action-required, expires
  - Financial terms: paypal, bank, invoice, payment, transfer
  - Download terms: download, install, execute, run, update
  - Threat terms: virus, malware, infected, compromised, alert

**Attack Detection**
- **Typosquatting**: Detects domains mimicking popular brands (google, paypal, etc.) using Levenshtein distance (+40 points)
- **Homograph Attacks**: Detects look-alike characters from different alphabets (+50 points)
- **Enhanced Keywords**: Categorized suspicious word detection (+10-40 points)

**URL Shortener Detection**
- **Known Shorteners**: Identifies 200+ URL shortening services (+15-45 points)
- **Risk-based Scoring**:
  - Reputable services (bit.ly, t.co): +30 points
  - Medium risk services (cutt.ly, is.gd): +25 points
  - Unknown/obscure services: +45 points

**File Download Checks**
- **Executable Files**: Flags .exe, .msi, .scr, .bat, .cmd, .ps1, .apk, .dmg, .pkg (+20 points)
- **Archive Files**: Flags .zip, .rar, .7z with additional keyword analysis (+20-40 points)

**Redirect Analysis**
- **Redirect Chain**: Follows redirects to reveal final destination
- **Multiple Hops**: Flags excessive redirects (+5 points per hop, max +20)
- **Chain Transparency**: Shows full redirect path

### External Threat Intelligence (Optional)

**Google Safe Browsing API** (Requires API key)
- **Threat Types**: Malware, phishing, social engineering, unwanted software
- **Scoring**: +40 points per threat detected
- **Response Time**: ~200-500ms

**AbuseIPDB** (Optional IP reputation)
- **Method**: REST API query for known abusive hosts
- **Detection**: Malicious infrastructure, high-abuse IP addresses
- **Scoring**: +25 to +60 based on confidence and report volume
- **Response Time**: ~200-500ms (only triggered for direct IP destinations)

**URLHaus** (Built-in)
- **Specialization**: Malware distribution URLs
- **Method**: Local database updated nightly
- **Scoring**: +80 points for known malicious URLs
- **Update Frequency**: Daily via GitHub Action

**Pattern Analysis** (Built-in fallback)
- **Method**: Local regex pattern matching
- **Detection**: Suspicious TLDs, keywords, IP addresses
- **Scoring**: +20 points per pattern match
- **Response Time**: Instant

### Scoring System

Each check adds points to the risk score:

- **High Risk** (≥80 points): Immediate warning, multiple serious issues
- **Medium Risk** (40-79 points): Caution advised, some concerns detected
- **Low Risk** (1-39 points): Minor concerns, generally safe
- **No Risk** (0 points): Clean, no issues detected

### Privacy Notes

- All local analysis happens in your browser
- External API calls (when enabled) go through secure Netlify Functions
- No URLs or results are stored or tracked
- Domain age and threat intelligence lookups are anonymous

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Quick Start

```bash
# Install dependencies
npm install

# Start development server with full features
npm run dev:netlify

# Or start basic development server
npm run dev
```

The application will be available at `http://localhost:8888`.

### Development Commands

```bash
# Run tests
npm run test

# Run end-to-end tests
npm run e2e

# Build for production
npm run build

# Run full verification (typecheck, lint, test, e2e, build)
npm run ci:verify
```

## Threat Intelligence

QRCheck can integrate with external threat intelligence sources for enhanced protection. This is optional - the tool works perfectly well without it.

### Available Security Feeds

**Google Safe Browsing API** (Recommended)
- Detects: Malware, phishing, social engineering, unwanted software
- Requires: Free API key
- Response time: ~200-500ms

**AbuseIPDB** (Optional IP reputation)
- Detects: High-abuse IP addresses and hostile infrastructure
- Method: REST API (requires free AbuseIPDB key)
- Response time: ~200-500ms (only triggered for direct IP destinations)

**Pattern Analysis** (Built-in)
- Detects: Suspicious TLDs, keywords, IP addresses
- Method: Local pattern matching
- Response time: Instant

**URLHaus** (Built-in)
- Detects: Malware distribution URLs
- Method: JSON API + local cache
- Updates: Nightly via GitHub Action

### Setting Up Google Safe Browsing (Optional)

**Step 1: Get API Key**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Safe Browsing API (APIs & Services → Library)
4. Create API key (APIs & Services → Credentials)
5. Optionally restrict key to Safe Browsing API only

**Step 2: Configure Environment**

For local development:
```bash
cp .env.example .env
# Edit .env and add:
GSB_API_KEY=your_google_safe_browsing_api_key_here
```

For Netlify deployment:
1. Go to Site settings → Build & deploy → Environment
2. Add environment variable:
   - Key: `GSB_API_KEY`
   - Value: Your API key

### Security Features

- Server-side URL resolution via Netlify Functions
- Maximum 10 redirect hops with 5-second timeouts
- Input validation and sanitization
- No caching of results
- Privacy-first design

## Deployment

To deploy to Netlify:

1. Push your code to GitHub
2. Connect your repository to Netlify
3. Configure environment variables (if using Google Safe Browsing)
4. Netlify will automatically build and deploy

## Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature-name`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`npm run ci:verify`)
6. Submit a pull request

### Areas for Contribution

- New security features and threat feeds
- UI/UX improvements
- Performance optimizations
- Documentation updates
- Bug fixes

### Architecture

- `src/lib/decode.ts` - QR code decoding and content parsing
- `src/lib/heuristics.ts` - Heuristic analysis engine
- `src/lib/shortener.ts` - URL shortener detection
- `src/lib/api.ts` - Netlify Function API integration
- `src/lib/camera.ts` - Camera handling for live scanning
- `src/App.svelte` - Main application component
- `functions/` - Netlify Functions for server-side processing
- `netlify.toml` - Netlify configuration

## Troubleshooting

### Google Safe Browsing API Not Working

**Symptoms**: Low threat detection, missing Google Safe Browsing in results

**Solutions**:
- Verify `GSB_API_KEY` is set correctly in Netlify environment
- Ensure Safe Browsing API is enabled in Google Cloud Console
- Check API quotas (Google provides generous free tier)
- Verify API key restrictions aren't too strict

### Environment Variables Not Working

**Symptoms**: Functions not using API keys, different behavior between local and production

**Solutions**:
- **Local**: Ensure `.env` file exists and is properly formatted
- **Netlify**: Check environment variables in Netlify dashboard
- **Build**: Verify environment variables are available during build
- **Debug**: Check Netlify function logs for issues

### Functions Not Deploying

**Symptoms**: 404 errors when calling API endpoints

**Solutions**:
- Ensure functions are in `functions/` directory
- Check `netlify.toml` configuration
- Look for build errors in Netlify deploy logs
- Verify function names match file names

### Performance Issues

**Symptoms**: Slow threat analysis, timeouts

**Solutions**:
- External APIs like Google Safe Browsing or AbuseIPDB can add ~500ms (expected)
- Functions may be slow on first use (cold start)
- Too many concurrent requests can cause delays

## Privacy

QRCheck is designed with privacy in mind:

- **Client-side Processing**: Most analysis happens in your browser
- **Secure Function Calls**: API calls made via secure Netlify Functions
- **No Data Storage**: No URLs or analysis results are stored or tracked
- **Minimal Logging**: Only aggregate metrics and error logs are collected
- **Open Source**: All code is publicly auditable
- **API Key Security**: Environment variables keep API keys secure

### Data Flow
1. **QR Code** → Browser (local decoding)
2. **URL Analysis** → Browser (local heuristics)
3. **Threat Intelligence** → Netlify Functions (secure API calls)
4. **Results** → Browser (no data stored)

### What We Don't Do
- Store scanned URLs
- Track user behavior
- Use analytics or tracking
- Share data with third parties
- Log personal information

## License

MIT License - see LICENSE file for details.
