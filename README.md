# QRCheck

Privacy-first QR code inspection tool that helps you identify potentially malicious QR codes before you scan them.

## Features

- **Local Analysis**: All checks are performed in your browser, no data is sent to external servers
- **URL Shortener Detection**: Identifies shortened links that can obscure the terminal endpoint
- **Heuristic Analysis**: Detects suspicious patterns in URLs including:
  - Excessive URL length
  - URL obfuscation techniques
  - Suspicious keywords
  - IP-based URLs
  - Suspicious top-level domains
- **Content Type Detection**: Recognizes different QR code content types:
  - URLs
  - Plain text
  - Email addresses
  - Phone numbers
  - SMS messages
  - WiFi credentials
  - Contact cards (vCard)
  - Geographic locations
- **Redirect Chain Analysis**: Follows redirects to reveal the resolved URL (terminal endpoint)
- **Threat Intelligence**: Optional integration with threat intelligence feeds

## How It Works

1. **Decode**: Extracts the raw data from QR codes
2. **Parse**: Identifies the content type and structure
3. **Analyze**: Runs heuristics to detect suspicious patterns
4. **Verify**: Optionally checks against threat intelligence feeds
5. **Report**: Provides a risk assessment with detailed findings

## URL Shortener Detection

QRCheck includes a comprehensive database of URL shortening services and can detect when a QR code contains a shortened URL. This is important because:

- Shortened URLs obscure the true destination
- They can be used to bypass security filters
- Attackers often use them to hide malicious sites

The tool checks against over 200 known shortening services including:
- Popular services (bit.ly, tinyurl.com, t.co)
- Niche services (cutt.ly, rebrand.ly, short.link)
- Abused services (tk, ml, ga top-level domains)

## Risk Assessment

QRCheck provides a risk score from 0-100 with three risk levels:

- **Low Risk (0-39)**: No obvious red flags
- **Medium Risk (40-69)**: Some suspicious patterns detected
- **High Risk (70+)**: Multiple risk factors or highly suspicious patterns

## URL Resolution & Link Analysis

QRCheck implements redirect enumeration and endpoint identification using Netlify Functions for secure URL resolution.

### Local Development

```bash
# Install dependencies (includes Netlify CLI)
npm install

# Run development server with Netlify Functions (recommended)
npm run dev:netlify

# Or run basic development server without URL resolution
npm run dev
```

When running with `npm run dev:netlify`, the application will be available at `http://localhost:8888` with full URL resolution capabilities.

### Netlify Function API

**POST** `/api/resolve` → `/.netlify/functions/resolve`

Request body:
```json
{
  "url": "https://example.com"
}
```

Response:
```json
{
  "ok": true,
  "analysis": {
    "input_url": "https://bit.ly/example",
    "redirect_chain": [
      "https://bit.ly/example",
      "https://intermediate.com/redirect",
      "https://target-site.com/login"
    ],
    "resolved_url": "https://target-site.com/login",
    "hop_count": 3
  }
}
```

### Security Features

- **Server-side Resolution**: URL resolution happens in Netlify Functions to avoid CORS limitations
- **Controlled Redirect Tracing**: Maximum of 10 hops with 5-second timeout per request
- **Input Validation**: Validates URL format and length before processing
- **No Caching**: Results are not cached to ensure fresh analysis
- **Privacy-First**: No data is stored or tracked

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Run development server with Netlify Functions (recommended)
npm run dev:netlify

# Or run basic development server
npm run dev

# Run tests
npm run test

# Build for production
npm run build

# Run end-to-end tests
npm run e2e

# Run full CI verification
npm run ci:verify
```

### Testing

The project includes comprehensive unit and end-to-end tests:

```bash
# Run unit tests
npm run test

# Run end-to-end tests
npm run e2e

# Run full verification (typecheck, lint, test, e2e, build)
npm run ci:verify
```

### Architecture

- `src/lib/decode.ts` - QR code decoding and content parsing
- `src/lib/heuristics.ts` - Heuristic analysis engine
- `src/lib/shortener.ts` - URL shortener detection
- `src/lib/api.ts` - Netlify Function API integration
- `src/lib/camera.ts` - Camera handling for live scanning
- `src/App.svelte` - Main application component
- `functions/resolve.ts` - Netlify Function for URL resolution
- `netlify.toml` - Netlify configuration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## Privacy

QRCheck is designed with privacy in mind:

- All processing happens in your browser
- No data is sent to external servers unless explicitly configured
- No tracking or analytics
- Open source and auditable

## License

MIT License - see LICENSE file for details.