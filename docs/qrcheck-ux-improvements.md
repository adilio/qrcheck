# QRCheck Simple UX Improvements

## Goal
Make QRCheck more inviting and friendly while adding a few key security checks. Keep everything simple - one page, minimal changes.

---

## 1. Visual/UX Improvements (Minimal Changes)

### A. Hero Section - Add Friendly Tagline
**Current:** Basic scanner interface
**New:** Add above scanner:

```html
<div class="hero">
  <h1>Don't just YOLO that QR code! 🎯</h1>
  <p>Check if it's safe before you scan. Quick, free, private.</p>
</div>
```

### B. Results Display - Make It Human-Friendly
**Current:** "Risk Score: 25"
**New:** Big, clear verdict cards

```html
<!-- Safe (0-39) -->
<div class="verdict safe">
  <span class="icon">✅</span>
  <h2>Looks Safe!</h2>
  <p>No red flags found. Always check the URL before entering info.</p>
</div>

<!-- Warning (40-69) -->
<div class="verdict warning">
  <span class="icon">⚠️</span>
  <h2>Be Careful</h2>
  <p>We found some suspicious signs. Don't enter passwords or payment info.</p>
</div>

<!-- Danger (70+) -->
<div class="verdict danger">
  <span class="icon">🚫</span>
  <h2>Don't Open This!</h2>
  <p>Multiple red flags detected. This is likely malicious.</p>
</div>
```

### C. Quick Explainer - One Simple Callout
Add a small collapsible section below the scanner:

```html
<details class="quick-info">
  <summary>What's "Quishing"? 🎣</summary>
  <p>Quishing = QR code phishing. Scammers stick fake QR codes on parking meters, 
  restaurant tables, and posters to steal your info. We check them first!</p>
</details>
```

### D. Simple Animations
Just add subtle effects to make it feel alive:

```css
/* Scanning pulse */
.camera-frame {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
  50% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
}

/* Result card slide in */
.verdict {
  animation: slideUp 0.4s ease-out;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## 2. New Security Checks

### A. Domain Age Check (Netlify Function)

**Create:** `netlify/functions/check-domain-age.ts`

```typescript
import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { domain } = JSON.parse(event.body || '{}');
  
  try {
    // Use WHOIS API (whoisxmlapi.com or similar)
    const response = await fetch(
      `https://www.whoisxmlapi.com/whoisserver/WhoisService?apiKey=${process.env.WHOIS_API_KEY}&domainName=${domain}&outputFormat=JSON`
    );
    
    const data = await response.json();
    const createdDate = data.WhoisRecord?.createdDate;
    
    if (!createdDate) {
      return {
        statusCode: 200,
        body: JSON.stringify({ age_days: null, risk_points: 0 })
      };
    }

    const ageInDays = Math.floor(
      (Date.now() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    let riskPoints = 0;
    if (ageInDays < 30) riskPoints = 20;
    else if (ageInDays < 90) riskPoints = 10;

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        age_days: ageInDays, 
        risk_points: riskPoints,
        message: ageInDays < 30 ? `Domain only ${ageInDays} days old (very new)` : `Domain ${ageInDays} days old`
      })
    };
  } catch (error) {
    return {
      statusCode: 200,
      body: JSON.stringify({ age_days: null, risk_points: 0 })
    };
  }
};
```

**Usage in existing code:**
```javascript
async function checkDomainAge(domain) {
  const response = await fetch('/.netlify/functions/check-domain-age', {
    method: 'POST',
    body: JSON.stringify({ domain })
  });
  return response.json();
}
```

### B. Typosquatting Detection (Client-Side - No API needed)

**Add to:** `src/lib/heuristics.ts`

```typescript
const popularBrands = [
  'google', 'microsoft', 'apple', 'amazon', 'paypal', 'facebook', 
  'instagram', 'twitter', 'netflix', 'spotify', 'chase', 'wellsfargo'
];

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i-1] === a[j-1]) {
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i-1][j-1] + 1,
          matrix[i][j-1] + 1,
          matrix[i-1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function checkTyposquatting(domain: string) {
  const domainName = domain.split('.')[0].toLowerCase();
  
  for (const brand of popularBrands) {
    const distance = levenshteinDistance(domainName, brand);
    if (distance > 0 && distance <= 2) {
      return {
        risk_points: 40,
        message: `Looks similar to "${brand}" but isn't the real site`
      };
    }
  }
  return { risk_points: 0 };
}
```

### C. Homograph Detection (Client-Side)

**Add to:** `src/lib/heuristics.ts`

```typescript
export function checkHomographs(domain: string) {
  // Common lookalike characters
  const homographs = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c'
  };
  
  for (const [fake, real] of Object.entries(homographs)) {
    if (domain.includes(fake)) {
      return {
        risk_points: 50,
        message: `Uses look-alike character "${fake}" instead of "${real}"`
      };
    }
  }
  return { risk_points: 0 };
}
```

### D. Enhanced Keywords (Client-Side)

**Add to:** `src/lib/heuristics.ts`

```typescript
const suspiciousKeywords = [
  'verify', 'urgent', 'suspended', 'confirm', 'locked',
  'winner', 'prize', 'free', 'claim', 'expired',
  'security', 'update', 'billing', 'refund'
];

export function checkSuspiciousKeywords(url: string) {
  const found = suspiciousKeywords.filter(kw => 
    url.toLowerCase().includes(kw)
  );
  
  if (found.length > 0) {
    return {
      risk_points: found.length * 10,
      message: `Contains suspicious words: ${found.join(', ')}`
    };
  }
  return { risk_points: 0 };
}
```

### E. Threat Intel (Optional Netlify Function)

**Create:** `netlify/functions/check-threat-intel.ts`

```typescript
import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { domain } = JSON.parse(event.body || '{}');
  
  try {
    // Option 1: Use Google Safe Browsing API
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${process.env.GOOGLE_SAFE_BROWSING_KEY}`,
      {
        method: 'POST',
        body: JSON.stringify({
          client: { clientId: "qrcheck", clientVersion: "1.0" },
          threatInfo: {
            threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url: `http://${domain}` }, { url: `https://${domain}` }]
          }
        })
      }
    );

    const data = await response.json();
    
    if (data.matches && data.matches.length > 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          threat_detected: true,
          risk_points: 100,
          message: 'Known malicious site'
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ threat_detected: false, risk_points: 0 })
    };

  } catch (error) {
    return {
      statusCode: 200,
      body: JSON.stringify({ threat_detected: false, risk_points: 0 })
    };
  }
};
```

---

## 3. Integrate New Checks

**Update:** `src/lib/heuristics.ts` - add to existing analysis function:

```typescript
import { checkTyposquatting, checkHomographs, checkSuspiciousKeywords } from './heuristics';

export async function analyzeURL(url: string) {
  const urlObj = new URL(url);
  const domain = urlObj.hostname;
  
  const checks = [];
  let totalRisk = 0;

  // Existing checks...
  
  // NEW: Typosquatting
  const typo = checkTyposquatting(domain);
  if (typo.risk_points > 0) {
    checks.push({ name: 'Typosquatting', ...typo });
    totalRisk += typo.risk_points;
  }
  
  // NEW: Homographs
  const homo = checkHomographs(domain);
  if (homo.risk_points > 0) {
    checks.push({ name: 'Look-alike Characters', ...homo });
    totalRisk += homo.risk_points;
  }
  
  // NEW: Suspicious keywords
  const keywords = checkSuspiciousKeywords(url);
  if (keywords.risk_points > 0) {
    checks.push({ name: 'Suspicious Words', ...keywords });
    totalRisk += keywords.risk_points;
  }
  
  // NEW: Domain age (async)
  try {
    const ageCheck = await fetch('/.netlify/functions/check-domain-age', {
      method: 'POST',
      body: JSON.stringify({ domain })
    }).then(r => r.json());
    
    if (ageCheck.risk_points > 0) {
      checks.push({ name: 'Domain Age', ...ageCheck });
      totalRisk += ageCheck.risk_points;
    }
  } catch (e) {
    // Skip if API fails
  }
  
  // NEW: Threat intel (async, optional)
  try {
    const threatCheck = await fetch('/.netlify/functions/check-threat-intel', {
      method: 'POST',
      body: JSON.stringify({ domain })
    }).then(r => r.json());
    
    if (threatCheck.threat_detected) {
      checks.push({ name: 'Threat Database', ...threatCheck });
      totalRisk += threatCheck.risk_points;
    }
  } catch (e) {
    // Skip if API fails
  }

  return {
    checks,
    totalRisk,
    verdict: totalRisk < 40 ? 'safe' : totalRisk < 70 ? 'warning' : 'danger'
  };
}
```

---

## 4. Simple CSS Updates

**Add to existing styles:**

```css
/* Friendly colors */
:root {
  --color-safe: #10B981;
  --color-warning: #F59E0B;
  --color-danger: #EF4444;
  --color-primary: #3B82F6;
}

/* Hero */
.hero {
  text-align: center;
  padding: 2rem 1rem;
}

.hero h1 {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  color: var(--color-primary);
}

.hero p {
  color: #6B7280;
  font-size: 1.1rem;
}

/* Verdict cards */
.verdict {
  padding: 2rem;
  border-radius: 1rem;
  text-align: center;
  animation: slideUp 0.4s ease-out;
}

.verdict.safe {
  background: #D1FAE5;
  border: 2px solid var(--color-safe);
}

.verdict.warning {
  background: #FEF3C7;
  border: 2px solid var(--color-warning);
}

.verdict.danger {
  background: #FEE2E2;
  border: 2px solid var(--color-danger);
}

.verdict .icon {
  font-size: 4rem;
  display: block;
  margin-bottom: 1rem;
}

.verdict h2 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

/* Quick info */
.quick-info {
  margin: 1rem auto;
  max-width: 600px;
  padding: 1rem;
  background: #F3F4F6;
  border-radius: 0.5rem;
}

.quick-info summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--color-primary);
}

.quick-info p {
  margin-top: 0.5rem;
  color: #4B5563;
}

/* Animations */
@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
  50% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
}
```

---

## 5. Environment Variables

**Add to Netlify Dashboard (or `.env`):**

```bash
# Optional - for domain age checks
WHOIS_API_KEY=your_key_here

# Optional - for threat intel
GOOGLE_SAFE_BROWSING_KEY=your_key_here
```

---

## 6. Fix Mobile Camera View

**Problem:** Camera feed opens below viewport and users have to scroll down.

**Solution:** Scroll to camera and ensure it's visible when opened.

**Add to your camera initialization code:**

```javascript
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment' } 
    });
    
    const videoElement = document.getElementById('camera-stream');
    videoElement.srcObject = stream;
    
    // NEW: Scroll camera into view on mobile
    const cameraView = document.getElementById('camera-mode');
    cameraView.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center' 
    });
    
    // Alternative: Scroll to top if camera is at top of page
    // window.scrollTo({ top: 0, behavior: 'smooth' });
    
  } catch (error) {
    handleCameraError(error);
  }
}
```

**Or if you want the camera to take full screen on mobile:**

```css
/* Add to existing styles */
@media (max-width: 768px) {
  .camera-view {
    /* When camera is active, make it prominent */
    position: sticky;
    top: 0;
    z-index: 100;
    background: white;
    margin: 0 -1rem; /* Extend to edges */
    padding: 1rem;
  }
  
  /* Or make it full viewport */
  .camera-view.active {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    background: black;
  }
}
```

**Add active class when camera starts:**

```javascript
function startCamera() {
  const cameraView = document.getElementById('camera-mode');
  cameraView.classList.add('active');
  
  // Scroll into view
  cameraView.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  // ... rest of camera code
}

function stopCamera() {
  const cameraView = document.getElementById('camera-mode');
  cameraView.classList.remove('active');
  // ... stop camera stream
}
```

**Recommended approach (simplest):**

```javascript
// Just scroll to camera when it opens
document.getElementById('camera-mode').scrollIntoView({ 
  behavior: 'smooth', 
  block: 'start' 
});
```

---

## Summary

**That's it! Simple changes:**

1. ✅ Friendly tagline at top
2. ✅ Big, clear verdict cards (Safe/Warning/Danger)
3. ✅ Quick "What's Quishing?" explainer
4. ✅ Subtle animations (pulse, slide)
5. ✅ 5 new security checks:
   - Domain age (Netlify Function)
   - Typosquatting detection
   - Homograph detection
   - Suspicious keywords
   - Threat intel (optional Netlify Function)

**No extra pages, no complex frameworks, minimal files:**
- `netlify/functions/check-domain-age.ts` (optional)
- `netlify/functions/check-threat-intel.ts` (optional)
- Updates to existing `heuristics.ts`
- Small CSS additions
- Small HTML additions to existing `App.svelte`

Total time to implement: **2-3 hours** instead of 8 weeks! 🎉