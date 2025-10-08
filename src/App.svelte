<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { DEV_ENABLE_MANUAL_URL } from './lib/flags';
  import { decodeQRFromFile, decodeQRFromImageData } from './lib/decode';
  import { analyze, type AnalysisResult } from './lib/heuristics';
  import { resolveChain, intel, type IntelResponse } from './lib/api';
  import { startCamera, stopCamera } from './lib/camera';

  type VerdictKey = AnalysisResult['verdict'];
  type IntelStatus = 'clean' | 'warn' | 'block' | 'info' | 'error';

  interface IntelCard {
    name: string;
    icon: string;
    status: IntelStatus;
    headline: string;
    detail: string;
  }

  const verdictMeta: Record<VerdictKey, { emoji: string; title: string; subtitle: string; tone: string }> = {
    SAFE: {
      emoji: '🟢',
      title: 'Likely Safe',
      subtitle: 'No major red flags detected.',
      tone: 'safe'
    },
    WARN: {
      emoji: '🟡',
      title: 'Proceed Carefully',
      subtitle: 'Some signals deserve a closer look.',
      tone: 'warn'
    },
    BLOCK: {
      emoji: '🔴',
      title: 'High Risk',
      subtitle: 'Multiple indicators suggest danger.',
      tone: 'block'
    }
  };

  const signalMeta: Record<
    string,
    {
      label: string;
      description: string;
    }
  > = {
    https: {
      label: 'Uses HTTPS',
      description: 'Encrypted HTTPS connections help prevent attackers from reading or modifying the traffic in transit.'
    },
    suspicious_tld: {
      label: 'Trusted TLD',
      description: 'Some top-level domains see disproportionate abuse; unfamiliar endings may indicate disposable or risky hosting.'
    },
    punycode: {
      label: 'IDN / Punycode',
      description: 'Punycode encodes international characters. Attackers use it to mimic well-known domains with subtle lookalike glyphs.'
    },
    file_download: {
      label: 'File download',
      description: 'Direct links to executables or archives can deliver unwanted software. Assess the source before running downloaded files.'
    },
    very_long: {
      label: 'URL length',
      description: 'Extremely long URLs often bury malicious parameters or tracking payloads that are hard to review at a glance.'
    },
    shortener: {
      label: 'Shortener',
      description: 'Shortened URLs hide the destination. Attackers rely on that opacity to lure users to unexpected sites.'
    },
    scheme_safe: {
      label: 'Scheme safe',
      description: 'Unsafe schemes like data:, file:, or custom protocols can execute local content or bypass browser safeguards.'
    },
    invalid_url: {
      label: 'Valid URL',
      description: 'We need a parsable URL to inspect. Invalid inputs bypass browser protections and cannot be verified.'
    }
  };

  const heuristicsLegend = [
    { text: 'Not HTTPS', score: '+15' },
    { text: 'Suspicious TLD', score: '+20' },
    { text: 'Punycode / IDN', score: '+10' },
    { text: 'Executable download', score: '+20' },
    { text: 'Very long URL', score: '+5' },
    { text: 'Shortener', score: '+6' },
    { text: 'data:/file: scheme', score: '+50' },
    { text: 'Score ≥50 → Block, ≥20 → Warn' }
  ];

  type Theme = 'dark' | 'light';

  const THEME_KEY = 'qrcheck-theme';

  let theme: Theme = 'dark';
  let themeReady = false;
  let urlText = '';
  let manualUrl = '';
  let result: AnalysisResult | null = null;
  let hops: string[] = [];
  let intelRes: IntelResponse | null = null;
  let error = '';
  let step = '';
  let busy = false;
  let scanning = false;
  let videoEl: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let scanFrameHandle: number | null = null;
  let cameraError = '';
  let dropActive = false;
  let clipboardError = '';
  let expandedSignal: string | null = null;
  let cameraButton: HTMLButtonElement | null = null;

  const captureCanvas = document.createElement('canvas');
  const captureCtx = captureCanvas.getContext('2d');

  $: verdictMetaInfo = result ? verdictMeta[result.verdict] : null;
  $: intelCards = buildIntelCards(intelRes);
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
    void tick().then(() => {
      cameraButton?.focus();
    });
  });

  async function onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await processFile(file);
  }

  async function processFile(file: File) {
    reset();
    try {
      step = 'Decoding QR code...';
      const raw = await decodeQRFromFile(file);
      await processDecoded(raw);
    } catch (err: any) {
      error = err?.message || 'Unable to analyze QR code';
      console.error('QR analysis failed:', err);
    } finally {
      step = '';
      busy = false;
    }
  }

  async function runManual() {
    const trimmed = manualUrl.trim();
    if (!trimmed) {
      error = 'Enter a URL to analyze';
      return;
    }
    try {
      await analyzeRaw(trimmed);
    } catch (err: any) {
      error = err?.message || 'Unable to analyze URL';
    }
  }

  async function analyzeRaw(raw: string) {
    reset();
    try {
      await processDecoded(raw);
    } finally {
      step = '';
      busy = false;
    }
  }

  async function processDecoded(raw: string) {
    urlText = raw;
    await runAnalysis(raw);
  }

  function reset({ busy: busyState = true }: { busy?: boolean } = {}) {
    error = '';
    cameraError = '';
    clipboardError = '';
    busy = busyState;
    step = '';
    result = null;
    hops = [];
    intelRes = null;
    expandedSignal = null;
  }

  async function runAnalysis(raw: string) {
    step = 'Analyzing locally...';
    result = analyze(raw);

    step = 'Following redirects...';
    const chain = await resolveChain(raw);
    hops = chain.hops;

    step = 'Checking threat sources...';
    intelRes = await intel(chain.final || raw);
  }

  async function startCameraScan() {
    if (busy || scanning) return;
    reset({ busy: false });
    try {
      if (!captureCtx) {
        throw new Error('Camera capture not supported in this browser');
      }
      stream = await startCamera();
      scanning = true;
      await tick();
      if (!videoEl) {
        throw new Error('Camera unavailable');
      }
      videoEl.srcObject = stream;
      await videoEl.play();
      scheduleScan();
    } catch (err: any) {
      cameraError = err?.message || 'Unable to start camera';
      stopCameraScan();
    }
  }

  function stopCameraScan() {
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
  }

  async function handleCameraDetection(raw: string) {
    stopCameraScan();
    try {
      await analyzeRaw(raw);
    } catch (err: any) {
      error = err?.message || 'Unable to analyze QR code';
    }
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
      clipboardError = 'Clipboard access is not available in this browser.';
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
          await analyzeRaw(text);
          return;
        }
      }
      clipboardError = 'Clipboard did not contain a QR image or URL.';
    } catch (err: any) {
      clipboardError = err?.message || 'Unable to read clipboard.';
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
        await analyzeRaw(text);
      }
    } catch (err: any) {
      clipboardError = err?.message || 'Unable to process clipboard content.';
    }
  }

  function onDragEnter(event: DragEvent) {
    event.preventDefault();
    dropActive = true;
  }

  function onDragLeave(event: DragEvent) {
    const current = event.currentTarget as HTMLElement | null;
    const related = event.relatedTarget as Node | null;
    if (current && related && current.contains(related)) {
      return;
    }
    dropActive = false;
  }

  async function onDrop(event: DragEvent) {
    dropActive = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      await processFile(files[0]);
      return;
    }
    const text = event.dataTransfer?.getData('text')?.trim();
    if (text) {
      await analyzeRaw(text);
    }
  }

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

  function toggleSignalDetail(key: string) {
    expandedSignal = expandedSignal === key ? null : key;
  }

  function closeSignalDetail() {
    expandedSignal = null;
  }

  function getSignalMeta(key: string) {
    return signalMeta[key] ?? { label: key, description: '' };
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (expandedSignal) {
        expandedSignal = null;
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
    if (scanning || busy) return;
    event.preventDefault();
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
        detail: 'No response received from URLHaus.'
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
        headline: 'Feed unavailable',
        detail: 'URLHaus responded with an error. Try again later.'
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
        detail: 'No response received from PhishTank.'
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
  <header class="hero">
    <div class="hero-top">
      <h1>QRCheck.ca</h1>
      <button class="theme-toggle" on:click={toggleTheme}>
        {theme === 'dark' ? '🌞 Light mode' : '🌙 Dark mode'}
      </button>
    </div>
    <p>Scan QR codes safely with local heuristics, redirect tracing, and live insights.</p>
    {#if urlText}
      <p class="muted subtle">Last decoded value: {urlText}</p>
    {/if}
  </header>

  <section class="grid">
    <section class="panel camera-panel">
      <h2>Scan with Camera</h2>
      {#if !scanning}
        <div class="camera-cta-wrapper">
          <button
            class="primary camera-cta"
            on:click={() => void startCameraScan()}
            disabled={busy}
            bind:this={cameraButton}
            type="button"
          >
            Open Camera
          </button>
          <p class="muted subtle camera-note">Press Enter or tap the button to start scanning instantly. Requires HTTPS on mobile.</p>
        </div>
      {:else}
        <div class="camera-feed">
          <video bind:this={videoEl} autoplay playsinline muted></video>
        </div>
        <div class="panel-actions camera-actions">
          <button class="secondary" on:click={stopCameraScan} type="button">Stop camera</button>
          <span class="muted subtle">Align the QR code inside the frame for auto-detect.</span>
        </div>
      {/if}
      {#if cameraError}<p class="error">{cameraError}</p>{/if}
    </section>

    <section class="panel upload-panel">
      <h2>Upload or Drop</h2>
      <div
        class={`dropzone ${dropActive ? 'active' : ''}`}
        role="region"
        aria-label="QR image drop zone"
        on:dragenter={onDragEnter}
        on:dragover|preventDefault
        on:dragleave={onDragLeave}
        on:drop|preventDefault={onDrop}
      >
        <p><span>📎</span> Drag & Drop a QR image here</p>
        <label class="file-trigger">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            on:change={onFile}
            disabled={busy}
          />
          <span>Browse files</span>
        </label>
      </div>
      <div class="panel-actions">
        <button class="secondary" on:click={pasteFromClipboard} disabled={busy}>Paste from clipboard</button>
        {#if clipboardError}<p class="error subtle">{clipboardError}</p>{/if}
      </div>
      {#if step}<p class="muted subtle">{step}</p>{/if}
      {#if error}<p class="error">{error}</p>{/if}
    </section>

    {#if DEV_ENABLE_MANUAL_URL}
      <section class="panel">
        <h2>Manual URL (dev/testing)</h2>
        <div class="input-row">
          <input
            class="w-full"
            placeholder="https://example.com"
            bind:value={manualUrl}
            disabled={busy}
          />
          <button class="secondary" on:click={runManual} disabled={busy}>Analyze</button>
        </div>
      </section>
    {/if}
  </section>

  {#if result && verdictMetaInfo}
    <section class={`verdict-card ${verdictMetaInfo.tone}`}>
      <div class="verdict-header">
        <div class="verdict-icon">{verdictMetaInfo.emoji}</div>
        <div class="verdict-info">
          <h3>{verdictMetaInfo.title}</h3>
          <p class="muted subtle">{verdictMetaInfo.subtitle}</p>
          <div class="verdict-tagline">
            <span class="label">Verdict:</span>
            <span class="value">{verdictMetaInfo.emoji} {verdictMetaInfo.title}</span>
          </div>
        </div>
        <div class="score-bubble">
          <span class="score">{result.score}</span>
          <span class="caption">threat score</span>
        </div>
      </div>

      <p class="dest-url">{result.normalized}</p>

      <p class="signal-help subtle">Tap a signal to learn why it matters.</p>

      <div class="signals">
        {#each result.signals as signal}
          {@const meta = getSignalMeta(signal.key)}
          <div class={`signal-chip-container ${signal.ok ? 'ok' : 'warn'} ${expandedSignal === signal.key ? 'active' : ''}`}>
            <button
              type="button"
              class="signal-chip"
              on:click={() => toggleSignalDetail(signal.key)}
              aria-expanded={expandedSignal === signal.key}
              aria-controls={`signal-detail-${signal.key}`}
            >
              <span class="chip-label">{signal.ok ? '✅' : '⚠️'} {meta.label}</span>
              <span class="chip-hint">{expandedSignal === signal.key ? 'Hide details' : 'Tap for details'}</span>
              {#if signal.info && expandedSignal !== signal.key}
                <small class="chip-summary">{signal.info}</small>
              {/if}
            </button>
            {#if expandedSignal === signal.key}
              <div class="chip-detail-card" role="region" id={`signal-detail-${signal.key}`}>
                <div class="chip-detail-body">
                  {#if meta.description}<p class="chip-detail">{meta.description}</p>{/if}
                  {#if signal.info}<p class="chip-context subtle">Observed: {signal.info}</p>{/if}
                </div>
                <button type="button" class="chip-close" on:click|stopPropagation={closeSignalDetail}>Close</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <details class="legend">
        <summary>How we score safety</summary>
        <ul>
          {#each heuristicsLegend as item}
            <li>
              <span>{item.text}</span>
              {#if item.score}<span>{item.score}</span>{/if}
            </li>
          {/each}
        </ul>
      </details>

      <div class="redirects">
        <h4>Redirects</h4>
        <ol>
          {#each hops as hop, index}
            <li>
              <span class="hop-index">{index + 1}</span>
              <span class="hop-url">{hop}</span>
            </li>
          {/each}
        </ol>
      </div>

      {#if intelCards.length}
        <div class="intel-section">
          <h4>Intel signals</h4>
          <div class="intel-grid">
            {#each intelCards as card}
              <div class={`intel-card ${card.status}`}>
                <div class="intel-source">{card.icon} {card.name}</div>
                <p class="intel-headline">{card.headline}</p>
                <p class="intel-detail">{card.detail}</p>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  {/if}

  <footer class="footer muted">
    <span>🛡️ Privacy-first. Everything runs in your browser.</span>
  </footer>
</main>
