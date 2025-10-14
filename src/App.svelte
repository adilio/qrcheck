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
  let redirectExpansionBlocked = false;
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
  let entryFileInput: HTMLInputElement | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let scanFrameHandle: number | null = null;
  let copyFeedback = '';
  let copyFeedbackTimeout: number | null = null;
  let originalInputUrl = '';

  const captureCanvas = document.createElement('canvas');
  const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

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

    // Initialize floating particles
    initializeParticles();
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
    redirectExpansionBlocked = false;
    intelRes = null;
    originalInputUrl = '';
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
    originalInputUrl = raw; // Store the original input URL immediately
    try {
      // Parse the QR content
      qrContent = parseQRContent(raw);

      // If it's a URL, continue with additional checks
      if (qrContent.type === 'url') {
        await runUrlAnalysis(raw);
        // Run heuristics analysis after gathering threat intel
        await runHeuristicsAnalysis(qrContent, intelRes);
      } else {
        // Run heuristics analysis for non-URL content
        await runHeuristicsAnalysis(qrContent);
        flow = 'complete';
        checksOpen = true; // Auto-expand the checks section

        // Wait for DOM to update, then scroll and check for threat intel
        tick().then(() => {
          // Auto-expand threat intel if there are danger results
          if (intelCards && intelCards.length > 0 && intelCards.some(card => card.status === 'block')) {
            intelOpen = true;
            console.log('Auto-expanding threat intel due to block status');
          }

          scrollToResults();
        });
      }
    } catch (err: any) {
      flow = 'error';
      error = err?.message || 'Unable to complete the analysis.';
      console.error('Analysis failed:', err);
    }
  }

  async function runHeuristicsAnalysis(content: QRContent, intel?: IntelResponse) {
    step = 'Analysing locally…';
    heuristicsResult = await analyzeHeuristics(content, intel);
    formattedHeuristics = formatHeuristicResults(heuristicsResult);
  }

  async function runUrlAnalysis(raw: string) {
    try {
      step = 'Following redirects…';

      // Check if this is a known shortener first
      const urlObj = new URL(raw);
      const domain = urlObj.hostname.toLowerCase();
      const knownShorteners = ['bit.ly', 'tinyurl.com', 't.co', 'qrco.de', 'buff.ly', 'goo.gl', 'ow.ly', 'tiny.cc'];
      const isKnownShortener = knownShorteners.some(shortener => domain.includes(shortener));

      // Use resolveChain for better CORS handling with known shorteners
      const redirectResult = await resolveChain(raw);
      hops = redirectResult.hops;
      urlText = redirectResult.final; // Update urlText to the final URL

      // Check if redirect expansion was blocked (only one hop means no expansion happened)
      redirectExpansionBlocked = isKnownShortener && hops.length === 1;

      step = 'Checking threat intel…';
      intelRes = await intel(redirectResult.final || raw);

      flow = 'complete';
      checksOpen = true; // Auto-expand the checks section

      // Wait for DOM to update, then scroll and check for threat intel
      tick().then(() => {
        // Auto-expand threat intel if there are danger results
        if (intelCards && intelCards.length > 0 && intelCards.some(card => card.status === 'block')) {
          intelOpen = true;
          console.log('Auto-expanding threat intel due to block status');
        }

        scrollToResults();
      });
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

      // Add video event listeners for error handling
      videoEl.addEventListener('error', (e) => {
        console.error('Video error:', e);
        stopCameraScan('error');
        cameraError = 'Video playback failed.';
      });

      videoEl.addEventListener('ended', () => {
        console.log('Video ended unexpectedly');
        stopCameraScan('error');
        cameraError = 'Video stream ended unexpectedly.';
      });

      await videoEl.play();

      // NEW: Scroll camera into view on mobile
      const cameraCard = document.querySelector('.camera-card');
      if (cameraCard) {
        cameraCard.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }

      // Camera started successfully
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
    } catch (err) {
      console.error('Error in scanFrame:', err);
      // Don't stop scanning on decode errors, just continue
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

  async function copyToClipboard(text: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        showCopyFeedback('✅ Copied!');
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
        showCopyFeedback('✅ Copied!');
      }
    } catch (err) {
      console.error('Failed to copy text:', err);
      showCopyFeedback('❌ Failed to copy');
    }
  }

  function showCopyFeedback(message: string) {
    copyFeedback = message;
    if (copyFeedbackTimeout) {
      clearTimeout(copyFeedbackTimeout);
    }
    copyFeedbackTimeout = setTimeout(() => {
      copyFeedback = '';
      copyFeedbackTimeout = null;
    }, 2000);
  }

  function getCopyButtonClass() {
    if (copyFeedback.includes('✅')) return 'copy-btn success';
    if (copyFeedback.includes('❌')) return 'copy-btn error';
    return 'copy-btn';
  }

  function initializeParticles() {
    if (typeof document === 'undefined') return;

    const container = document.getElementById('particleContainer');
    if (!container) return;

    const colors = ['pink', 'magenta', 'purple', 'blue', 'cyan', 'deep-purple'];
    const particleCount = 300;

    function createParticle() {
      const particle = document.createElement('div');
      particle.className = `particle ${colors[Math.floor(Math.random() * colors.length)]}`;

      const size = Math.random() * 4 + 2;
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;

      particle.style.left = `${Math.random() * 100}%`;
      particle.style.top = `${Math.random() * -100}vh`;

      const duration = Math.random() * 15 + 10;
      particle.style.animationDuration = `${duration}s`;

      particle.style.animationDelay = `${Math.random() * -20}s`;

      const drift = (Math.random() - 0.5) * 100;
      particle.style.setProperty('--drift', `${drift}px`);

      container.appendChild(particle);

      setTimeout(() => {
        particle.remove();
        createParticle();
      }, (duration + 20) * 1000);
    }

    for (let i = 0; i < particleCount; i++) {
      createParticle();
    }

    setInterval(() => {
      if (container.children.length < particleCount * 2) {
        createParticle();
      }
    }, 200);
  }

  function scrollToResults() {
    if (typeof document === 'undefined') return;

    // Add a small delay to ensure the DOM has updated
    setTimeout(() => {
      // Find the verdict card
      const verdictCard = document.querySelector('.verdict-card');
      if (verdictCard) {
        console.log('Scrolling to verdict card');
        verdictCard.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      } else {
        console.log('Verdict card not found, trying fallback');
        // Fallback: scroll to the bottom of the page
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 100); // 100ms delay
  }

  
  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (learnMoreOpen) {
        learnMoreOpen = false;
        event.stopPropagation();
      }
      // Check if Escape should stop scanning
      if (scanning) {
        stopCameraScan('idle');
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
    if (scanning || flow === 'processing') {
      return;
    }
    event.preventDefault();
    // Start camera scan when Enter is pressed
    void startCameraScan();
  }

  function buildIntelCards(data: IntelResponse | null): IntelCard[] {
    if (!data) return [];
    const cards: IntelCard[] = [];
    const urlHausCard = buildURLHausCard(data.urlhaus);
    if (urlHausCard) cards.push(urlHausCard);
    return cards;
  }

  function buildURLHausCard(data: any): IntelCard | null {
    if (data === null) {
      return {
        name: 'URLHaus',
        icon: '🌐',
        status: 'error',
        headline: 'Lookup failed',
        detail: 'Unable to check URLHaus database.'
      };
    }
    if (!data || !data.ok) {
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
    if (status === 'error' || status === 'failed') {
      return {
        name: 'URLHaus',
        icon: '🌐',
        status: 'error',
        headline: 'Feed error',
        detail: 'URLHaus returned an error. Try again later.'
      };
    }
    if (data.matches && data.matches.length > 0) {
      return {
        name: 'URLHaus',
        icon: '🌐',
        status: 'block',
        headline: `Reported malicious (${data.matches.length} match${data.matches.length > 1 ? 'es' : ''})`,
        detail: 'This URL is flagged as malicious by URLHaus.'
      };
    }
    return {
      name: 'URLHaus',
      icon: '🌐',
      status: 'clean',
      headline: 'No listings found',
      detail: 'This URL is not currently flagged by URLHaus.'
    };
  }

  </script>

<main class="page" on:paste={handlePasteEvent}>
  <!-- Floating particles background -->
  <div class="particle-container" id="particleContainer"></div>

  <div class="content">
    <header>
      <div class="logo">
        <h1>QRCheck.ca</h1>
        <p>Privacy-first QR inspection</p>
      </div>
      <button class="settings-btn" on:click={toggleTheme} type="button" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {theme === 'dark' ? '🌙' : '☀️'}
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

    <div class="hero-wrapper">
      <div class="hero-glow"></div>
      <div class="hero-card">
        <div class="hero-icon">
          <div class="emoji-wrapper">
            <div class="emoji-glow"></div>
            <span class="emoji">🎯</span>
          </div>
        </div>
        <h2 class="hero-title">Don't just YOLO that QR code!</h2>
        <p class="hero-subtitle">Know before you scan. Quick, free, private safety check.</p>

        <div class="action-buttons">
          <button class="action-btn" type="button" on:click={() => void startCameraScan()}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
            </svg>
            <span>Camera</span>
          </button>
          <label class="action-btn">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
            </svg>
            <span>Upload</span>
            <input type="file" accept="image/*" bind:this={entryFileInput} on:change={handleEntryFile} style="display: none;" />
          </label>
        </div>

        {#if originalInputUrl && flow === 'complete'}
          <div class="last-scanned">
            <p class="last-scanned-label">Last scanned</p>
            <p class="last-scanned-url">{originalInputUrl}</p>
          </div>
        {/if}
      </div>
    </div>

    <!-- Quishing Explainer -->
    <button class="quishing-btn" on:click={() => learnMoreOpen = !learnMoreOpen}>
      <span class="quishing-icon">⚡</span>
      <span>What's "Quishing"?</span>
      <span class="quishing-arrow">{learnMoreOpen ? '▼' : '▶'}</span>
    </button>

    {#if learnMoreOpen}
      <div class="quishing-content">
        <h3>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 1.5rem; height: 1.5rem; color: #60a5fa;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
          </svg>
          Quishing Explained
        </h3>
        <p>"Quishing" is QR code phishing - a cyberattack where malicious QR codes redirect you to fake websites designed to steal your personal information, passwords, or financial data. Always verify before you scan!</p>
      </div>
    {/if}

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
      <!-- Human-friendly verdict display -->
      <div class="verdict {verdictMetaInfo.tone}">
        <span class="icon">{verdictMetaInfo.emoji}</span>
        <h2>{#if verdictMetaInfo.tone === 'safe'}Looks Safe! 👍{:else if verdictMetaInfo.tone === 'warn'}Be Careful ⚠️{:else}Don't Open This! 🚫{/if}</h2>
        <p>
          {#if verdictMetaInfo.tone === 'safe'}No red flags found. Always check the URL before entering info.
          {:else if verdictMetaInfo.tone === 'warn'}We found some suspicious signs. Don't enter passwords or payment info.
          {:else}Multiple red flags detected. This is likely malicious.
          {/if}
        </p>
      </div>

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
          <div class="input-url-section">
            <h4>URL Analysis</h4>
            <div class="original-url">
              <span class="url-label">📍 Input URL:</span>
              <span class="url-value">{originalInputUrl}</span>
              <button class="copy-btn-small" type="button" on:click={() => copyToClipboard(originalInputUrl)} title="Copy input URL">
                📋
              </button>
            </div>
          </div>

          <div class="resolution-section">
            <h4>Resolution Results</h4>
            {#if hops.length > 1}
              <div class="resolved-url">
                <span class="url-label">🎯 Resolved URL (Terminal Endpoint):</span>
                <span class="url-value">{hops[hops.length - 1]}</span>
                <button class="{getCopyButtonClass()}" type="button" on:click={() => copyToClipboard(hops[hops.length - 1])} title="Copy resolved URL">
                  {copyFeedback || '📋 Copy'}
                </button>
              </div>
              <div class="redirect-summary">
                <span class="redirect-count">
                  {hops.length - 1} redirect{hops.length - 1 > 1 ? 's' : ''}
                </span>
                <span class="redirect-info">
                  Shortened link expanded to show true destination
                </span>
              </div>
            {:else if hops.length === 1}
              <div class="resolved-url">
                <span class="url-label">🎯 Resolved URL (Terminal Endpoint):</span>
                <span class="url-value">{hops[0]}</span>
                <button class="{getCopyButtonClass()}" type="button" on:click={() => copyToClipboard(hops[0])} title="Copy resolved URL">
                  {copyFeedback || '📋 Copy'}
                </button>
              </div>
              <div class="redirect-summary single">
                {#if redirectExpansionBlocked}
                  <span class="redirect-count">⚠️ Redirects blocked</span>
                  <span class="redirect-info">Browser security prevents expansion of this shortened link</span>
                {:else}
                  <span class="redirect-count">No redirects</span>
                  <span class="redirect-info">Direct link - no expansion needed</span>
                {/if}
              </div>
            {/if}
          </div>
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

      {#if qrContent?.type === 'url' && hops.length > 1}
        <details class="drawer" bind:open={redirectsOpen}>
          <summary>📊 Redirect Chain ({hops.length} hops)</summary>
          <div class="redirect-preview">
            <div class="redirect-path">{hops[0]} → … → {hops[hops.length - 1]}</div>
          </div>
          <ol class="redirect-list">
            {#each hops as hop, index}
              <li>
                <span class="redirect-index">
                  {index === 0 ? '📍 Start' : index === hops.length - 1 ? '🎯 Terminal' : `${index + 1}.`}
                </span>
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

    <footer>
      <div class="footer-content">
        <p>Your privacy matters. All scans are processed locally.</p>
        <div class="footer-links">
          <a href="https://github.com/adilio/qrcheck" target="_blank" rel="noopener noreferrer" class="footer-link">
            View on GitHub
          </a>
          <span class="footer-separator">•</span>
          <span class="footer-credit">
            Made with 💜 in 🇨🇦 by <a href="https://github.com/adilio" target="_blank" rel="noopener noreferrer" class="footer-link">Adil Leghari</a>
          </span>
        </div>
      </div>
    </footer>
  </div>
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
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(8px);
    border-radius: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    list-style-type: none;
    color: white;
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
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .input-url-section, .resolution-section {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(8px);
    border-radius: 0.5rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .input-url-section h4, .resolution-section h4 {
    margin: 0 0 0.75rem 0;
    color: white;
    font-size: 1rem;
    font-weight: 600;
  }

  .original-url {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 0.25rem;
    border-left: 4px solid #3b82f6;
    word-break: break-all;
  }

  .original-url, .final-url {
    margin-bottom: 0.5rem;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    word-break: break-all;
  }

  .resolved-url {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(34, 197, 94, 0.2);
    border-radius: 0.25rem;
    border-left: 4px solid #22c55e;
    word-break: break-all;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .copy-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .copy-btn:hover {
    background: var(--accent-color);
    color: white;
  }

  .copy-btn.success {
    background: #22c55e;
    color: white;
    border-color: #22c55e;
  }

  .copy-btn.error {
    background: #ef4444;
    color: white;
    border-color: #ef4444;
  }

  .copy-btn-small {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 0.25rem;
    padding: 0.25rem 0.375rem;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    min-width: 2rem;
    height: 2rem;
    flex-shrink: 0;
  }

  .copy-btn-small:hover {
    background: var(--accent-color);
    color: white;
  }

  .redirect-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    background-color: var(--bg-secondary);
    border-radius: 0.25rem;
    font-size: 0.875rem;
    margin-top: 0.5rem;
  }

  .redirect-summary.single {
    justify-content: center;
    background-color: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
  }

  .redirect-count {
    font-weight: 600;
    color: #f59e0b;
  }

  .redirect-info {
    color: var(--text-secondary);
    font-size: 0.8rem;
  }

  .redirect-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.75rem;
  }

  .redirect-list li {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .redirect-preview {
    margin-bottom: 1rem;
    padding: 0.75rem;
    background-color: var(--bg-secondary);
    border-radius: 0.25rem;
    border-left: 4px solid #3b82f6;
  }

  .redirect-path {
    font-family: monospace;
    font-size: 0.875rem;
    color: var(--text-primary);
    word-break: break-all;
  }

  .url-label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.875rem;
  }

  .url-value {
    font-family: monospace;
    font-size: 0.875rem;
    line-height: 1.4;
    color: white;
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