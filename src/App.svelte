<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { DEV_ENABLE_MANUAL_URL } from './lib/flags';
  import { decodeQRFromFile, decodeQRFromImageData, parseQRContent, type QRContent } from './lib/decode';
  import { analyzeHeuristics, formatHeuristicResults } from './lib/heuristics';
  import { resolveChain, intel, type IntelResponse } from './lib/api';
  import { startCamera, stopCamera } from './lib/camera';

  type VerdictKey = 'SAFE' | 'WARN' | 'BLOCK';
  type IntelStatus = 'clean' | 'warn' | 'block' | 'info' | 'error';
  type Theme = 'dark' | 'light';
  type FlowState = 'idle' | 'scanning' | 'processing' | 'complete' | 'error';

  interface IntelCard {
    name: string;
    icon: string;
    status: IntelStatus;
    headline: string;
    detail: string;
  }

  interface Alert {
    id: string;
    tone: 'info' | 'warn' | 'error';
    message: string;
    hint?: string;
  }

  const THEME_KEY = 'qrcheck-theme';

  const verdictMeta: Record<VerdictKey, { emoji: string; heading: string; summary: string; guidance: string; tone: string }> = {
    SAFE: {
      emoji: '✅',
      heading: 'Safe',
      summary: 'Reputable destination',
      guidance: 'Local checks show no obvious risk indicators.',
      tone: 'safe'
    },
    WARN: {
      emoji: '⚠️',
      heading: 'Caution',
      summary: 'Mixed signals detected',
      guidance: 'Review the highlighted checks before you proceed.',
      tone: 'warn'
    },
    BLOCK: {
      emoji: '⛔️',
      heading: 'High risk',
      summary: 'Likely malicious destination',
      guidance: 'Avoid visiting or sharing this link.',
      tone: 'block'
    }
  };

  const signalMeta: Record<
    string,
    {
      title: string;
      safe: string;
      warn: string;
      learn: string;
    }
  > = {
    https: {
      title: 'HTTPS',
      safe: 'Secure HTTPS connection',
      warn: 'Not using HTTPS – avoid entering credentials',
      learn: 'Encrypted HTTPS connections make it harder for attackers to read or modify traffic. When a QR code resolves to plain HTTP, treat forms and logins as untrusted.'
    },
    suspicious_tld: {
      title: 'Top-level domain',
      safe: 'Common top-level domain',
      warn: 'Unfamiliar TLD – verify the sender',
      learn: 'Some top-level domains see disproportionate abuse because they are cheap or poorly regulated. Confirm that the domain matches the brand you expect before proceeding.'
    },
    punycode: {
      title: 'Lookalike characters',
      safe: 'Standard Latin domain',
      warn: 'Lookalike characters detected',
      learn: 'Internationalised domain names (punycode) can imitate trusted brands with subtle glyph differences. Inspect the decoded hostname carefully.'
    },
    file_download: {
      title: 'File download',
      safe: 'No direct file download',
      warn: 'Downloads a file – scan before opening',
      learn: 'Unexpected executables or archives may deliver malware. Verify the source and scan the file before running anything you download.'
    },
    very_long: {
      title: 'URL length',
      safe: 'Readable URL length',
      warn: 'Very long URL – watch for hidden params',
      learn: 'Extremely long URLs can hide malicious parameters or tracking payloads. Review the destination in a desktop browser before entering data.'
    },
    shortener: {
      title: 'Link shortener',
      safe: 'Destination is visible',
      warn: 'Shortened link – destination hidden',
      learn: 'Shortened URLs obscure the true destination. Expand the link or rely on preview tools before following it.'
    },
    scheme_safe: {
      title: 'URL scheme',
      safe: 'Browser-friendly scheme',
      warn: 'Dangerous scheme detected',
      learn: 'Schemes such as data:, file:, or custom protocols can execute local content or bypass browser safeguards. Prefer HTTPS URLs shared by trusted sources.'
    },
    invalid_url: {
      title: 'URL validity',
      safe: 'Valid URL supplied',
      warn: 'Unrecognised URL – cannot be verified',
      learn: 'We need a parsable URL to inspect. Non-standard or malformed values bypass browser protections and cannot be assessed.'
    }
  };

  const heuristicsLegend = [
    { text: 'Not HTTPS', score: '+15' },
    { text: 'Suspicious TLD', score: '+20' },
    { text: 'Punycode / IDN', score: '+10' },
    { text: 'Executable download', score: '+20' },
    { text: 'Very long URL', score: '+5' },
    { text: 'Reputable shortener', score: '+15' },
    { text: 'Unknown shortener', score: '+45' },
    { text: 'Suspicious keywords', score: '+40' },
    { text: 'data:/file: scheme', score: '+50' },
    { text: 'Score ≥70 → Block, ≥40 → Warn' }
  ];

  let theme: Theme = 'dark';
  let themeReady = false;
  let flow: FlowState = 'idle';
  let urlText = '';
  let manualUrl = '';
  let qrContent: QRContent | null = null;
  let heuristicsResult: any = null;
  let formattedHeuristics: any = null;
  let hops: string[] = [];
  let intelRes: IntelResponse | null = null;
  let error = '';
  let cameraError = '';
  let clipboardError = '';
  let step = '';
  let scanning = false;
  let learnMoreOpen = false;
  let checksOpen = false;
  let redirectsOpen = false;
  let intelOpen = false;
  let manualUrlOpen = false;
  let videoEl: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let scanFrameHandle: number | null = null;

  const captureCanvas = document.createElement('canvas');
  const captureCtx = captureCanvas.getContext('2d');

  $: verdictMetaInfo = heuristicsResult ? verdictMeta[getVerdictFromHeuristics()] : null;
  $: intelCards = buildIntelCards(intelRes);
  $: busy = flow === 'processing';
  $: alerts = buildAlerts();

  $: if (themeReady) {
    applyTheme(theme);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_KEY, theme);
    }
  }

  
  onMount(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') {
      theme = stored;
    }
    applyTheme(theme);
    themeReady = true;
    window.addEventListener('keydown', handleGlobalKeydown);
  });

  onDestroy(() => {
    stopCameraScan();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleGlobalKeydown);
    }
  });

  function applyTheme(next: Theme) {
    if (typeof document === 'undefined') return;
    document.body.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
  }

  
  function buildAlerts(): Alert[] {
    const items: Alert[] = [];
    if (cameraError) {
      items.push({
        id: 'camera',
        tone: 'error',
        message: cameraError,
        hint: 'Check browser permissions or switch to the upload option.'
      });
    }
    if (clipboardError) {
      items.push({
        id: 'clipboard',
        tone: 'warn',
        message: clipboardError,
        hint: 'Try copying the QR again or use the file upload.'
      });
    }
    if (error) {
      items.push({
        id: 'analysis',
        tone: 'error',
        message: error
      });
    }
    return items;
  }

  function dismissAlert(id: string) {
    if (id === 'camera') cameraError = '';
    if (id === 'clipboard') clipboardError = '';
    if (id === 'analysis') error = '';
  }

  function prepareForAnalysis() {
    error = '';
    step = '';
    qrContent = null;
    heuristicsResult = null;
    formattedHeuristics = null;
    hops = [];
    intelRes = null;
    learnMoreOpen = false;
    checksOpen = false;
    redirectsOpen = false;
    intelOpen = false;
    flow = 'processing';
  }

  function getVerdictFromHeuristics(): VerdictKey {
    if (!heuristicsResult) return 'SAFE';
    
    if (heuristicsResult.risk === 'high') return 'BLOCK';
    if (heuristicsResult.risk === 'medium') return 'WARN';
    return 'SAFE';
  }

  function getSignalAction(key: string, ok: boolean) {
    const meta = signalMeta[key];
    if (!meta) return ok ? 'Healthy signal' : 'Needs attention';
    return ok ? meta.safe : meta.warn;
  }

  function getSignalLearn(key: string) {
    return signalMeta[key]?.learn ?? 'Detailed heuristics information unavailable.';
  }

  async function handleEntryFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await processFile(file);
    if (entryFileInput) {
      entryFileInput.value = '';
    }
  }

  async function processFile(file: File) {
    prepareForAnalysis();
    try {
      step = 'Decoding QR image…';
      const raw = await decodeQRFromFile(file);
      await processDecoded(raw);
    } catch (err: any) {
      flow = 'error';
      error = err?.message || 'Unable to analyse that QR image.';
      console.error('QR analysis failed:', err);
    } finally {
      step = '';
    }
  }

  async function analyzeFromText(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      error = 'Enter a URL to analyse.';
      return;
    }
    prepareForAnalysis();
    await processDecoded(trimmed);
  }

  async function runManual() {
    await analyzeFromText(manualUrl);
  }

  async function processDecoded(raw: string) {
    urlText = raw;
    try {
      // Parse the QR content
      qrContent = parseQRContent(raw);
      
      // Run heuristics analysis
      await runHeuristicsAnalysis(qrContent);
      
      // If it's a URL, continue with additional checks
      if (qrContent.type === 'url') {
        await runUrlAnalysis(raw);
      } else {
        flow = 'complete';
      }
    } catch (err: any) {
      flow = 'error';
      error = err?.message || 'Unable to complete the analysis.';
      console.error('Analysis failed:', err);
    }
  }

  async function runHeuristicsAnalysis(content: QRContent) {
    step = 'Analysing locally…';
    heuristicsResult = await analyzeHeuristics(content);
    formattedHeuristics = formatHeuristicResults(heuristicsResult);
  }

  async function runUrlAnalysis(raw: string) {
    try {
      step = 'Following redirects…';
      const chain = await resolveChain(raw);
      hops = chain.hops;

      // If we detected a shortener but couldn't resolve redirects, add a helpful note
      const urlObj = new URL(raw);
      const domain = urlObj.hostname.toLowerCase();
      const knownShorteners = ['bit.ly', 'tinyurl.com', 't.co', 'qrco.de', 'buff.ly', 'goo.gl', 'ow.ly'];
      if (knownShorteners.some(shortener => domain.includes(shortener)) && hops.length === 1) {
        // It's a known shortener but we couldn't resolve the redirect
        console.info(`Shortened URL detected from ${domain}, but redirect expansion is limited by browser security.`);
      }

      step = 'Checking threat intel…';
      intelRes = await intel(chain.final || raw);

      flow = 'complete';
    } finally {
      step = '';
    }
  }

  async function startCameraScan() {
    if (busy || scanning) return;
    cameraError = '';
    step = 'Align the QR code inside the frame';
    try {
      if (!captureCtx) {
        throw new Error('Camera capture is not supported by this browser.');
      }
      // Request persistent camera permissions with more specific constraints
      stream = await startCamera();
      scanning = true;
      flow = 'scanning';
      await tick();
      if (!videoEl) {
        throw new Error('Camera unavailable.');
      }
      videoEl.srcObject = stream;
      await videoEl.play();
      scheduleScan();
    } catch (err: any) {
      console.error('Camera failed to start:', err);
      stopCameraScan('error');
      cameraError = err?.message || 'Unable to access the camera.';
    }
  }

  function stopCameraScan(nextFlow: FlowState | null = null) {
    if (scanFrameHandle !== null) {
      cancelAnimationFrame(scanFrameHandle);
      scanFrameHandle = null;
    }
    if (stream) {
      stopCamera(stream);
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
    scanning = false;
    if (nextFlow) {
      flow = nextFlow;
    } else if (flow === 'scanning') {
      flow = heuristicsResult ? 'complete' : 'idle';
    }
    if (flow !== 'processing') {
      step = '';
    }
  }

  async function handleCameraDetection(raw: string) {
    stopCameraScan();
    await analyzeFromText(raw);
  }

  function scheduleScan() {
    scanFrameHandle = requestAnimationFrame(() => {
      void scanFrame();
    });
  }

  async function scanFrame() {
    if (!scanning || !videoEl || !captureCtx) {
      return;
    }
    try {
      if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const width = videoEl.videoWidth;
        const height = videoEl.videoHeight;
        if (width && height) {
          captureCanvas.width = width;
          captureCanvas.height = height;
          captureCtx.drawImage(videoEl, 0, 0, width, height);
          const image = captureCtx.getImageData(0, 0, width, height);
          try {
            const raw = decodeQRFromImageData(image);
            await handleCameraDetection(raw);
            return;
          } catch {
            // continue scanning
          }
        }
      }
    } finally {
      if (scanning) {
        scheduleScan();
      }
    }
  }

  async function pasteFromClipboard() {
    clipboardError = '';
    if (!navigator.clipboard) {
      clipboardError = 'Clipboard access is not available. Use upload instead.';
      return;
    }
    try {
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              const file = new File([blob], `clipboard.${type.split('/')[1] || 'png'}`, { type });
              await processFile(file);
              return;
            }
          }
        }
      }
      if (navigator.clipboard.readText) {
        const text = (await navigator.clipboard.readText())?.trim();
        if (text) {
          await analyzeFromText(text);
          return;
        }
      }
      clipboardError = 'Clipboard did not contain a QR image or URL. Try copying it again or use upload.';
    } catch (err: any) {
      clipboardError = `${err?.message || 'Unable to read the clipboard.'} Grant access or try the upload option.`;
    }
  }

  async function handlePasteEvent(event: ClipboardEvent) {
    const data = event.clipboardData;
    if (!data) return;
    const items = Array.from(data.items || []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    try {
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) {
          event.preventDefault();
          await processFile(file);
          return;
        }
      }
      const text = data.getData('text')?.trim();
      if (text) {
        event.preventDefault();
        await analyzeFromText(text);
      }
    } catch (err: any) {
      error = err?.message || 'Unable to process clipboard content.';
    }
  }

  
  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (learnMoreOpen) {
        learnMoreOpen = false;
        event.stopPropagation();
      }
      return;
    }
    if (event.key !== 'Enter') return;
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'A') {
        return;
      }
      if (target.isContentEditable) {
        return;
      }
    }
    if (scanning || flow === 'processing') return;
    event.preventDefault();
    // Start camera scan when Enter is pressed
    void startCameraScan();
  }

  function buildIntelCards(data: IntelResponse | null): IntelCard[] {
    if (!data) return [];
    const cards: IntelCard[] = [];
    const urlHausCard = buildURLHausCard(data.urlhaus);
    const phishTankCard = buildPhishTankCard(data.phishtank);
    if (urlHausCard) cards.push(urlHausCard);
    if (phishTankCard) cards.push(phishTankCard);
    return cards;
  }

  function buildURLHausCard(data: any): IntelCard | null {
    if (data === null) {
      return {
        name: 'URLHaus',
        icon: '🌐',
        status: 'info',
        headline: 'Not checked',
        detail: 'Configure VITE_API_BASE to enable redirect lookups.'
      };
    }
    if (!data) {
      return {
        name: 'URLHaus',
        icon: '🌐',
        status: 'error',
        headline: 'Lookup failed',
        detail: 'No response from URLHaus.'
      };
    }
    const status = String(data.query_status || '').toLowerCase();
    if (status === 'no_results') {
      return {
        name: 'URLHaus',
        icon: '🌐',
        status: 'clean',
        headline: 'No listings found',
        detail: 'This URL is not currently flagged by URLHaus.'
      };
    }
    if (status === 'error') {
      return {
        name: 'URLHaus',
        icon: '🌐',
        status: 'error',
        headline: 'Feed error',
        detail: 'URLHaus returned an error. Try again later.'
      };
    }
    return {
      name: 'URLHaus',
      icon: '🌐',
      status: 'block',
      headline: data.threat ? `Reported ${data.threat}` : 'Listed as malicious',
      detail: `Status: ${data.url_status || 'unknown'}.`
    };
  }

  function buildPhishTankCard(data: any): IntelCard | null {
    if (data === null) {
      return {
        name: 'PhishTank',
        icon: '🎣',
        status: 'info',
        headline: 'Not checked',
        detail: 'Set PHISHTANK_API_KEY to enable phishing lookups.'
      };
    }
    if (!data) {
      return {
        name: 'PhishTank',
        icon: '🎣',
        status: 'error',
        headline: 'Lookup failed',
        detail: 'No response from PhishTank.'
      };
    }
    if (typeof data === 'object' && 'error' in data) {
      return {
        name: 'PhishTank',
        icon: '🎣',
        status: 'error',
        headline: 'Feed error',
        detail: String(data.error)
      };
    }
    const inDb = data?.in_database ?? data?.results?.in_database ?? false;
    const verified = data?.verified ?? data?.results?.verified ?? false;

    if (inDb && verified) {
      return {
        name: 'PhishTank',
        icon: '🎣',
        status: 'block',
        headline: 'Verified phishing',
        detail: 'This URL is confirmed as phishing by PhishTank.'
      };
    }
    if (inDb) {
      return {
        name: 'PhishTank',
        icon: '🎣',
        status: 'warn',
        headline: 'Reported phishing',
        detail: 'Listed in PhishTank but verification is pending.'
      };
    }
    if (data?.ok === true || !inDb) {
      return {
        name: 'PhishTank',
        icon: '🎣',
        status: 'clean',
        headline: 'No phishing reports',
        detail: 'This URL is not in the PhishTank database.'
      };
    }
    return {
      name: 'PhishTank',
      icon: '🎣',
      status: 'info',
      headline: 'Unknown response',
      detail: 'PhishTank returned an unrecognised payload.'
    };
  }
</script>

<main class="page" on:paste={handlePasteEvent}>
  <header class="top-bar">
    <div class="brand">
      <span class="brand-title">QRCheck.ca</span>
      <span class="brand-tagline">Privacy-first QR inspection</span>
    </div>
    <button class="theme-toggle" on:click={toggleTheme} type="button" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
      {theme === 'dark' ? '🌞' : '🌙'}
    </button>
  </header>

  {#if alerts.length}
    <div class="alerts" aria-live="polite">
      {#each alerts as alert (alert.id)}
        <div class={`alert ${alert.tone}`}>
          <span class="alert-icon">
            {alert.tone === 'error' ? '⚠️' : alert.tone === 'warn' ? '⚠️' : 'ℹ️'}
          </span>
          <div class="alert-body">
            <p>{alert.message}</p>
            {#if alert.hint}<p class="alert-hint">{alert.hint}</p>{/if}
          </div>
          <button
            class="alert-dismiss"
            type="button"
            on:click={() => dismissAlert(alert.id)}
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <section class="intro">
    <div class="intro-card">
      <h1>Know before you scan</h1>
      <p>Get a quick verdict on any QR code without leaving your browser.</p>
      <ul class="guide">
        <li>
          <span class="step-icon">①</span>
          <span>Point camera</span>
        </li>
        <li>
          <span class="step-icon">②</span>
          <span>Check verdict</span>
        </li>
        <li>
          <span class="step-icon">③</span>
          <span>Share safely</span>
        </li>
      </ul>
      <div class="cta-row">
        <button class="primary camera-btn" type="button" on:click={() => void startCameraScan()}>
          📷 Camera
        </button>
        <label class="primary upload-btn">
          📁 Upload
          <input type="file" accept="image/*" on:change={handleEntryFile} style="display: none;" />
        </label>
        {#if DEV_ENABLE_MANUAL_URL}
          <button class="secondary manual-btn" type="button" on:click={() => (manualUrlOpen = true)}>
          Scan or upload QR
        </button>
        {/if}
        {#if step && (flow === 'processing' || flow === 'scanning')}
          <span class="status-pill">{step}</span>
        {/if}
      </div>
      {#if urlText && flow === 'complete'}
        <p class="last-scan">
          Last scanned: <span>{urlText}</span>
        </p>
      {/if}
    </div>
  </section>

  {#if manualUrlOpen}
    <div class="modal-backdrop" role="presentation" on:click={() => (manualUrlOpen = false)} on:keydown={(e) => { if (e.key === 'Escape') manualUrlOpen = false; }} tabindex="-1"></div>
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
      <div class="modal-content" role="document">
        <header>
          <h2 id="modal-title">Scan or upload a QR code</h2>
          <button class="modal-close" on:click={() => (manualUrlOpen = false)} aria-label="Close modal">✕</button>
        </header>
        <div class="modal-body">
          <p>Enter a URL to analyze:</p>
          <input
            type="url"
            placeholder="https://example.com"
            bind:value={manualUrl}
            on:keydown={(e) => { if (e.key === 'Enter') { manualUrlOpen = false; void runManual(); } }}
          />
          <div class="modal-actions">
            <button class="primary" on:click={() => { manualUrlOpen = false; void runManual(); }} disabled={!manualUrl.trim()}>
              Analyze
            </button>
            <button class="secondary" on:click={() => (manualUrlOpen = false)}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if flow === 'scanning'}
    <section class="camera-card" aria-live="polite">
      <header>
        <h2>Live camera scan</h2>
        <span class="camera-hint">Align the QR code inside the frame</span>
      </header>
      <div class="camera-frame">
        <video bind:this={videoEl} autoplay playsinline muted></video>
      </div>
      <div class="camera-actions">
        <button class="secondary" type="button" on:click={() => stopCameraScan(heuristicsResult ? 'complete' : 'idle')}>
          Stop scanning
        </button>
      </div>
    </section>
  {/if}

  {#if heuristicsResult && formattedHeuristics && verdictMetaInfo}
    <section class={`verdict-card ${verdictMetaInfo.tone}`} aria-live="polite">
      <header class="verdict-summary">
        <span class="verdict-emoji">{verdictMetaInfo.emoji}</span>
        <div class="verdict-headings">
          <h2>{verdictMetaInfo.heading} – {verdictMetaInfo.summary}</h2>
          <p>{verdictMetaInfo.guidance}</p>
        </div>
        <div class="score-chip">
          <span class="score-value">{heuristicsResult.score}</span>
          <span class="score-label">Risk score</span>
        </div>
      </header>

      {#if qrContent?.type === 'url'}
        <div class="url-display">
          <div class="original-url">
            <span class="url-label">Original URL:</span>
            <span class="url-value">{urlText}</span>
          </div>
          {#if hops.length > 1}
            <div class="final-url">
              <span class="url-label">Final destination:</span>
              <span class="url-value">{hops[hops.length - 1]}</span>
            </div>
          {/if}
        </div>
      {:else}
        <div class="content-type">
          <span class="type-label">Content type:</span>
          <span class="type-value">{qrContent?.type || 'unknown'}</span>
        </div>
        <p class="content-text">{qrContent?.text || 'No content'}</p>
      {/if}

      <details class="drawer" bind:open={checksOpen}>
        <summary>See all checks</summary>
        <div class="risk-summary">
          <div class="risk-indicator" style="color: {formattedHeuristics.riskColor}">
            {formattedHeuristics.riskText}
          </div>
          <div class="risk-score">{formattedHeuristics.summary}</div>
        </div>
        
        {#if formattedHeuristics.details.length}
          <ul class="risk-details">
            {#each formattedHeuristics.details as detail}
              <li class="risk-detail">{detail}</li>
            {/each}
          </ul>
        {:else}
          <p class="no-issues">No specific issues detected.</p>
        {/if}
        
        {#if heuristicsResult.recommendations.length}
          <div class="recommendations">
            <h4>Recommendations:</h4>
            <ul>
              {#each heuristicsResult.recommendations as recommendation}
                <li>{recommendation}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </details>

      {#if qrContent?.type === 'url' && hops.length}
        <details class="drawer" bind:open={redirectsOpen}>
          <summary>Redirect history</summary>
          <ol class="redirect-list">
            {#each hops as hop, index}
              <li>
                <span class="redirect-index">{index + 1}</span>
                <span class="redirect-url">{hop}</span>
              </li>
            {/each}
          </ol>
        </details>
      {/if}

      {#if intelCards.length}
        <details class="drawer" bind:open={intelOpen}>
          <summary>Threat intel</summary>
          <div class="intel-grid">
            {#each intelCards as card}
              <div class={`intel-card ${card.status}`}>
                <span class="intel-source">{card.icon} {card.name}</span>
                <p class="intel-headline">{card.headline}</p>
                <p class="intel-detail">{card.detail}</p>
              </div>
            {/each}
          </div>
        </details>
      {/if}

      <button
        class="link-button"
        type="button"
        on:click={() => (learnMoreOpen = !learnMoreOpen)}
        aria-expanded={learnMoreOpen}
      >
        {learnMoreOpen ? 'Hide Learn More' : 'Learn more about these checks'}
      </button>

      {#if learnMoreOpen}
        <section class="learn-more">
          <h3>How QRCheck evaluates destinations</h3>
          <div class="learn-list">
            {#if heuristicsResult.details.shortenerCheck?.isShortener}
              <div class="learn-item">
                <span class="learn-term">URL Shortener</span>
                <span class="learn-copy">Shortened URLs obscure the true destination. Expand the link or rely on preview tools before following it.</span>
              </div>
            {/if}
            
            {#if heuristicsResult.details.urlLength?.isExcessive}
              <div class="learn-item">
                <span class="learn-term">URL Length</span>
                <span class="learn-copy">Extremely long URLs can hide malicious parameters or tracking payloads. Review the destination in a desktop browser before entering data.</span>
              </div>
            {/if}
            
            {#if heuristicsResult.details.obfuscation?.hasObfuscation}
              <div class="learn-item">
                <span class="learn-term">URL Obfuscation</span>
                <span class="learn-copy">Obfuscated URLs may use encoding to hide malicious content. Be cautious with URLs that contain unusual encoding patterns.</span>
              </div>
            {/if}
            
            {#if heuristicsResult.details.suspiciousKeywords?.hasKeywords}
              <div class="learn-item">
                <span class="learn-term">Suspicious Keywords</span>
                <span class="learn-copy">Keywords like "login", "verify", or "security" may be used in phishing attempts. Verify the source before proceeding.</span>
              </div>
            {/if}
            
            {#if heuristicsResult.details.domainReputation?.isIPBased}
              <div class="learn-item">
                <span class="learn-term">IP-based URLs</span>
                <span class="learn-copy">URLs that use IP addresses instead of domain names may be suspicious. Legitimate services typically use domain names.</span>
              </div>
            {/if}
            
            {#if heuristicsResult.details.domainReputation?.hasSuspiciousTLD}
              <div class="learn-item">
                <span class="learn-term">Suspicious TLD</span>
                <span class="learn-copy">Some top-level domains see disproportionate abuse because they are cheap or poorly regulated. Confirm that the domain matches the brand you expect.</span>
              </div>
            {/if}
          </div>
          
          <div class="legend">
            <h4>Scoring quick reference</h4>
            <ul>
              {#each heuristicsLegend as item}
                <li>
                  <span>{item.text}</span>
                  {#if item.score}<span>{item.score}</span>{/if}
                </li>
              {/each}
            </ul>
          </div>
        </section>
      {/if}
    </section>
  {:else if flow === 'processing'}
    <section class="processing-card" aria-live="polite">
      <p>{step || 'Running checks…'}</p>
    </section>
  {/if}

  <footer class="footer">
    <span>🛡️ Privacy-first. Everything runs in your browser.</span>
  </footer>

  </main>

<style>
  /* Add styles for the new components */
  .content-type {
    display: flex;
    align-items: center;
    margin-bottom: 0.5rem;
    padding: 0.5rem;
    background-color: var(--bg-secondary);
    border-radius: 0.25rem;
  }
  
  .type-label {
    font-weight: 600;
    margin-right: 0.5rem;
    color: var(--text-secondary);
  }
  
  .type-value {
    font-family: monospace;
    background-color: var(--bg-tertiary);
    padding: 0.125rem 0.25rem;
    border-radius: 0.125rem;
    text-transform: uppercase;
    font-size: 0.875rem;
  }
  
  .content-text {
    word-break: break-all;
    margin-top: 0.5rem;
  }
  
  .risk-summary {
    display: flex;
    align-items: center;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background-color: var(--bg-secondary);
    border-radius: 0.25rem;
  }
  
  .risk-indicator {
    font-weight: 700;
    font-size: 1.125rem;
    margin-right: 1rem;
  }
  
  .risk-score {
    font-family: monospace;
    color: var(--text-secondary);
  }
  
  .risk-details {
    margin-bottom: 1rem;
  }
  
  .risk-detail {
    margin-bottom: 0.5rem;
    padding: 0.5rem;
    background-color: var(--bg-secondary);
    border-radius: 0.25rem;
    list-style-type: '⚠️ ';
  }
  
  .no-issues {
    color: var(--text-secondary);
    font-style: italic;
    margin-bottom: 1rem;
  }
  
  .recommendations {
    margin-top: 1rem;
  }
  
  .recommendations h4 {
    margin-bottom: 0.5rem;
    color: var(--text-primary);
  }
  
  .recommendations ul {
    margin-left: 1.5rem;
  }
  
  .recommendations li {
    margin-bottom: 0.25rem;
  }
  
  .learn-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .learn-item {
    padding: 0.75rem;
    background-color: var(--bg-secondary);
    border-radius: 0.25rem;
  }
  
  .learn-term {
    font-weight: 600;
    display: block;
    margin-bottom: 0.25rem;
  }
  
  .learn-copy {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .camera-btn, .upload-btn {
    margin-right: 0.5rem;
    cursor: pointer;
    min-width: 120px;
  }

  .upload-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }

  
  .url-display {
    margin-bottom: 1rem;
  }

  .original-url, .final-url {
    margin-bottom: 0.5rem;
    padding: 0.75rem;
    background-color: var(--bg-secondary);
    border-radius: 0.25rem;
    word-break: break-all;
  }

  .final-url {
    border-left: 4px solid #22c55e;
    background-color: rgba(34, 197, 94, 0.1);
  }

  .url-label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .url-value {
    font-family: monospace;
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .manual-btn {
    min-width: 120px;
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 1000;
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1001;
  }

  .modal-content {
    background-color: var(--bg-primary);
    border-radius: 0.5rem;
    padding: 0;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
  }

  .modal-content header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border-color);
  }

  .modal-content h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-primary);
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 0.25rem;
    border-radius: 0.25rem;
    transition: background-color 0.2s;
  }

  .modal-close:hover {
    background-color: var(--bg-secondary);
  }

  .modal-body {
    padding: 1.5rem;
  }

  .modal-body p {
    margin-bottom: 1rem;
    color: var(--text-primary);
  }

  .modal-body input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 0.25rem;
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 1rem;
    margin-bottom: 1rem;
  }

  .modal-body input:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }

  .modal-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
</style>