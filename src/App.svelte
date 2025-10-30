<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { DEV_ENABLE_MANUAL_URL } from './lib/flags';
  import { decodeQRFromFile, decodeQRFromImageData, parseQRContent, type QRContent } from './lib/decode';
  import {
    analyzeHeuristics,
    formatHeuristicResults,
    type CheckStatus,
    type FormattedHeuristicSummary,
    type FormattedIntelSource,
    type FormattedHeuristicCheck
  } from './lib/heuristics';
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
  let formattedHeuristics: FormattedHeuristicSummary | null = null;
  let hops: string[] = [];
  let redirectExpansionBlocked = false;
  let intelRes: IntelResponse | null = null;
  let flaggedChecks: FormattedHeuristicCheck[] = [];
  let error = '';
  let cameraError = '';
  let clipboardError = '';
  let step = '';

  // Transparent Analysis System - New State
  interface AnalysisStep {
    id: string;
    name: string;
    description: string;
    status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
    icon: string;
    duration?: number;
    details?: string;
    educationalInfo?: {
      what: string;
      why: string;
      how: string;
    };
  }

  let analysisSteps: AnalysisStep[] = [];
  let currentStepIndex = 0;
  let overallProgress = 0;
  let estimatedTimeRemaining = 0;
  let totalAnalysisTime = 0;
  let activeTooltip: string | null = null;
  let tooltipPosition = { x: 0, y: 0 };
  let showProgressSection = false;

  let scanning = false;
  let learnMoreOpen = false;
  let checksOpen = false;
  let redirectsOpen = false;
  let intelOpen = false;
  let manualUrlOpen = false;
  let entryFileInput: HTMLInputElement | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let videoErrorHandler: ((e: Event) => void) | null = null;
  let videoEndedHandler: (() => void) | null = null;
  let scanFrameHandle: number | null = null;
  let copyFeedback = '';
  let copyFeedbackTimeout: number | null = null;
  let originalInputUrl = '';

  const captureCanvas = document.createElement('canvas');
  const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

  $: verdictMetaInfo = heuristicsResult ? verdictMeta[getVerdictFromHeuristics()] : null;
  $: intelCards = buildIntelCards(intelRes, formattedHeuristics?.intelSources || []);
  $: busy = flow === 'processing';
  $: alerts = buildAlerts();
  $: terminalUrl = hops.length ? hops[hops.length - 1] : '';
  $: redirectCount = Math.max(hops.length - 1, 0);
  $: flaggedChecks = formattedHeuristics
    ? formattedHeuristics.checks.filter((check) => check.status !== 'pass')
    : [];

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

    // Initialize transparent analysis steps
    initializeAnalysisSteps();
  }

  // Transparent Analysis System - Initialize Analysis Steps
  function initializeAnalysisSteps() {
    analysisSteps = [
      {
        id: 'decode',
        name: 'QR Code Decoding',
        description: 'Extracting content from QR code',
        status: 'pending',
        icon: '📱',
        educationalInfo: {
          what: 'Reading the QR code to extract the embedded information',
          why: 'QR codes can contain URLs, text, or other data that needs to be read',
          how: 'Using computer vision to identify and decode the QR code pattern'
        }
      },
      {
        id: 'redirects',
        name: 'URL Redirect Analysis',
        description: 'Following redirect chains to final destination',
        status: 'pending',
        icon: '🔗',
        educationalInfo: {
          what: 'Tracing URL redirects through multiple hops to find the final destination',
          why: 'Shortened URLs (like bit.ly) hide the final destination, which could be malicious',
          how: 'Following HTTP redirects and expanding shortened URLs step by step'
        }
      },
      {
        id: 'threat-intel-google',
        name: 'Google Safe Browsing Check',
        description: 'Checking against Google\'s threat database',
        status: 'pending',
        icon: '🛡️',
        educationalInfo: {
          what: 'Querying Google\'s Safe Browsing API for known malicious URLs',
          why: 'Google maintains a massive database of unsafe websites from millions of sources',
          how: 'Comparing the URL against Google\'s constantly updated threat intelligence'
        }
      },
      {
        id: 'threat-intel-abuseipdb',
        name: 'IP Reputation Check',
        description: 'Analyzing IP address reputation',
        status: 'pending',
        icon: '🌐',
        educationalInfo: {
          what: 'Checking if the URL resolves to a suspicious IP address',
          why: 'Malicious websites often use IP addresses instead of domain names',
          how: 'Looking up the IP address in abuse databases to check for malicious activity'
        }
      },
      {
        id: 'threat-intel-urlhaus',
        name: 'Malware Database Check',
        description: 'Searching URLHaus malware database',
        status: 'pending',
        icon: '🦠',
        educationalInfo: {
          what: 'Checking against URLHaus database of known malware distribution URLs',
          why: 'URLHaus tracks URLs that distribute malware and are actively dangerous',
          how: 'Comparing against a frequently updated list of malicious URLs'
        }
      },
      {
        id: 'heuristics-length',
        name: 'URL Length Analysis',
        description: 'Checking for excessively long URLs',
        status: 'pending',
        icon: '📏',
        educationalInfo: {
          what: 'Analyzing the length of the URL for suspicious patterns',
          why: 'Attackers often use very long URLs to hide malicious code or obfuscate destinations',
          how: 'Checking if URL length exceeds normal thresholds and examining the structure'
        }
      },
      {
        id: 'heuristics-obfuscation',
        name: 'Obfuscation Detection',
        description: 'Looking for encoded or hidden content',
        status: 'pending',
        icon: '🎭',
        educationalInfo: {
          what: 'Detecting attempts to hide or disguise the true destination',
          why: 'Attackers use encoding, Base64, or other techniques to hide malicious URLs',
          how: 'Scanning for common obfuscation patterns and unusual character sequences'
        }
      },
      {
        id: 'heuristics-tld',
        name: 'Domain Analysis',
        description: 'Checking domain reputation and structure',
        status: 'pending',
        icon: '🏠',
        educationalInfo: {
          what: 'Analyzing the domain name for suspicious characteristics',
          why: 'Suspicious TLDs (.tk, .ml) and IP-based domains are commonly used in attacks',
          how: 'Checking domain age, TLD reputation, and whether it uses an IP address'
        }
      },
      {
        id: 'heuristics-keywords',
        name: 'Suspicious Keywords',
        description: 'Scanning for suspicious words and phrases',
        status: 'pending',
        icon: '🔍',
        educationalInfo: {
          what: 'Looking for words commonly associated with phishing and attacks',
          why: 'Attackers often use urgent or enticing language to manipulate users',
          how: 'Scanning for patterns like "verify", "suspended", "winner", etc.'
        }
      },
      {
        id: 'domain-age',
        name: 'Domain Age Check',
        description: 'Verifying when the domain was registered',
        status: 'pending',
        icon: '📅',
        educationalInfo: {
          what: 'Checking how long the domain has existed',
          why: 'Newly registered domains are more likely to be malicious (common in attacks)',
          how: 'Querying domain registration databases to check creation date'
        }
      }
    ];

    // Reset progress tracking
    currentStepIndex = 0;
    overallProgress = 0;
    estimatedTimeRemaining = 0;
    totalAnalysisTime = 0;
    showProgressSection = true;
  }

  // Execute individual analysis step
  async function executeAnalysisStep(stepId: string): Promise<void> {
    const step = analysisSteps.find(s => s.id === stepId);
    if (!step) return;

    step.status = 'running';
    const startTime = Date.now();

    try {
      // Update display
      updateProgressDisplay();

      switch (stepId) {
        case 'decode':
          step.description = 'Reading QR code pattern...';
          // QR decoding happens before this function is called
          break;

        case 'redirects':
          step.description = 'Following redirects...';
          // This will be handled in runUrlAnalysis
          break;

        case 'threat-intel-google':
          step.description = 'Checking Google Safe Browsing database...';
          // This will be handled in the threat intel check
          break;

        case 'threat-intel-abuseipdb':
          step.description = 'Analyzing IP reputation...';
          // This will be handled in the threat intel check
          break;

        case 'threat-intel-urlhaus':
          step.description = 'Searching malware databases...';
          // This will be handled in the intel() function
          break;

        case 'heuristics-length':
        case 'heuristics-obfuscation':
        case 'heuristics-tld':
        case 'heuristics-keywords':
          step.description = 'Analyzing URL structure...';
          // These will be handled in runHeuristicsAnalysis
          break;

        case 'domain-age':
          step.description = 'Checking domain registration date...';
          // This will be handled in runHeuristicsAnalysis
          break;
      }

      step.status = 'completed';
      step.duration = Date.now() - startTime;

    } catch (error) {
      step.status = 'error';
      step.details = error instanceof Error ? error.message : 'Unknown error';
      step.duration = Date.now() - startTime;
    }

    updateProgressDisplay();
  }

  // Update progress display
  function updateProgressDisplay() {
    const completedSteps = analysisSteps.filter(s => s.status === 'completed').length;
    const totalSteps = analysisSteps.filter(s => s.status !== 'skipped').length;
    overallProgress = Math.round((completedSteps / totalSteps) * 100);

    // Estimate time remaining based on average step duration
    const completedDurations = analysisSteps
      .filter(s => s.status === 'completed' && s.duration)
      .map(s => s.duration!);

    if (completedDurations.length > 0) {
      const avgDuration = completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length;
      const remainingSteps = totalSteps - completedSteps;
      estimatedTimeRemaining = Math.round((remainingSteps * avgDuration) / 1000);
    }

    totalAnalysisTime = analysisSteps
      .filter(s => s.duration)
      .reduce((total, s) => total + s.duration!, 0);
  }

  // Tooltip functions
  function showInfoTooltip(stepId: string, event: MouseEvent) {
    event.stopPropagation();
    activeTooltip = stepId;
    tooltipPosition = {
      x: event.clientX,
      y: event.clientY
    };
  }

  function hideInfoTooltip() {
    activeTooltip = null;
  }

  function handleClickOutside() {
    hideInfoTooltip();
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

    // Additional client-side validation
    if (!file.type.startsWith('image/')) {
      flow = 'error';
      error = 'Please select an image file (JPG, PNG, GIF, etc.)';
      if (entryFileInput) {
        entryFileInput.value = '';
      }
      return;
    }

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
      // Keep the step message to show user feedback
      step = 'Failed to decode QR image';
    } finally {
      // Don't clear step on error so user sees what failed
      if (flow !== 'error') {
        step = '';
      }
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

      // Mark QR decode step as complete
      await executeAnalysisStep('decode');

      // If it's a URL, continue with additional checks
      if (qrContent.type === 'url') {
        await runUrlAnalysis(raw);
        // Run heuristics analysis after gathering threat intel
        await runHeuristicsAnalysis(qrContent, intelRes);
      } else {
        // Run heuristics analysis for non-URL content
        await runHeuristicsAnalysis(qrContent);
        flow = 'complete';
        // Only auto-expand checks if there are actual issues found
        checksOpen = formattedHeuristics?.issues.length > 0;

        // Auto-expand threat intel only if there are danger results
        if (intelCards && intelCards.length > 0 && hasActionableIntel(intelCards)) {
          intelOpen = true;
          console.log('Auto-expanding threat intel due to block status');
        }

        // Auto-expand redirect chain only if there are multiple hops (shortened URLs)
        if (hops && hops.length > 1) {
          redirectsOpen = true;
          console.log('Auto-expanding redirect chain due to shortened URL');
        }
      }
    } catch (err: any) {
      flow = 'error';
      error = err?.message || 'Unable to complete the analysis.';
      console.error('Analysis failed:', err);
    }
  }

  async function runHeuristicsAnalysis(content: QRContent, intel?: IntelResponse) {
    step = 'Analysing locally…';

    // Execute heuristic analysis steps
    await executeAnalysisStep('heuristics-length');
    await executeAnalysisStep('heuristics-obfuscation');
    await executeAnalysisStep('heuristics-tld');
    await executeAnalysisStep('heuristics-keywords');
    await executeAnalysisStep('domain-age');

    heuristicsResult = await analyzeHeuristics(content, intel);
    formattedHeuristics = formatHeuristicResults(heuristicsResult);
  }

  async function runUrlAnalysis(raw: string) {
    try {
      // Execute redirect analysis step
      await executeAnalysisStep('redirects');

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

      // Execute threat intelligence steps
      await executeAnalysisStep('threat-intel-google');
      await executeAnalysisStep('threat-intel-abuseipdb');
      await executeAnalysisStep('threat-intel-urlhaus');

      // Run the actual threat intelligence check
      intelRes = await intel(redirectResult.final || raw);

      flow = 'complete';
      // Only auto-expand checks if there are actual issues found
      checksOpen = formattedHeuristics?.issues.length > 0;

      // Auto-expand threat intel only if there are danger results
      if (intelCards && intelCards.length > 0 && hasActionableIntel(intelCards)) {
        intelOpen = true;
        console.log('Auto-expanding threat intel due to block status');
      }

      // Auto-expand redirect chain only if there are multiple hops (shortened URLs)
      if (hops && hops.length > 1) {
        redirectsOpen = true;
        console.log('Auto-expanding redirect chain due to shortened URL');
      }
    } finally {
      step = '';
      showProgressSection = false; // Hide progress section when complete

      // Now scroll to results after the analysis section is visible
      tick().then(() => {
        scrollToResults();
      });
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

      // Clean up any existing event listeners first
      if (videoErrorHandler && videoEl) {
        videoEl.removeEventListener('error', videoErrorHandler);
      }
      if (videoEndedHandler && videoEl) {
        videoEl.removeEventListener('ended', videoEndedHandler);
      }

      // Create new event handlers
      videoErrorHandler = (e) => {
        console.error('Video error:', e);
        stopCameraScan('error');
        cameraError = 'Video playback failed.';
      };

      videoEndedHandler = () => {
        console.log('Video ended unexpectedly');
        stopCameraScan('error');
        cameraError = 'Video stream ended unexpectedly.';
      };

      // Add video event listeners for error handling
      videoEl.addEventListener('error', videoErrorHandler);
      videoEl.addEventListener('ended', videoEndedHandler);

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
      // Remove event listeners before cleaning up
      if (videoErrorHandler) {
        videoEl.removeEventListener('error', videoErrorHandler);
        videoErrorHandler = null;
      }
      if (videoEndedHandler) {
        videoEl.removeEventListener('ended', videoEndedHandler);
        videoEndedHandler = null;
      }
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

  function hasActionableIntel(cards: IntelCard[]): boolean {
    return cards.some((card) => card.status === 'block' || card.status === 'warn' || card.status === 'error');
  }

  function statusIcon(status: CheckStatus): string {
    switch (status) {
      case 'fail':
        return '⛔️';
      case 'warn':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '✅';
    }
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

    // Use requestAnimationFrame for better timing across environments
    requestAnimationFrame(() => {
      // Try multiple potential scroll targets in order of preference
      const targets = [
        '.analysis-results',           // New analysis results section
        '.verdict-card',              // Original verdict card
        '.result-summary',            // Summary card within results
        '.content-panel',             // Content type panel
        '.analysis-complete'          // Fallback class
      ];

      let targetFound = false;

      for (const selector of targets) {
        const element = document.querySelector(selector);
        if (element) {
          console.log(`Scrolling to ${selector}`);
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
          targetFound = true;
          break;
        }
      }

      if (!targetFound) {
        console.log('No scroll targets found, using fallback');
        // Fallback: scroll to bottom with a small delay
        setTimeout(() => {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
          });
        }, 100);
      }
    });
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

  const intelStatusWeight: Record<IntelStatus, number> = {
    clean: 0,
    info: 1,
    warn: 2,
    block: 3,
    error: 4
  };

  const intelIcons: Record<string, string> = {
    'Google Safe Browsing': '🛡️',
    URLHaus: '🌐',
    AbuseIPDB: '🚨',
    'Threat intelligence': '🛰️'
  };

  const intelStatusMap: Record<FormattedIntelSource['status'], IntelStatus> = {
    clean: 'clean',
    warn: 'warn',
    block: 'block',
    error: 'error'
  };

  function convertSourceToCard(source: FormattedIntelSource): IntelCard {
    return {
      name: source.name,
      icon: intelIcons[source.name] || '🌐',
      status: intelStatusMap[source.status],
      headline: source.headline,
      detail: source.detail
    };
  }

  function buildIntelCards(data: IntelResponse | null, enhancedSources: FormattedIntelSource[]): IntelCard[] {
    const cardsByName = new Map<string, IntelCard>();

    enhancedSources.forEach((source) => {
      cardsByName.set(source.name, convertSourceToCard(source));
    });

    if (data) {
      const urlHausCard = buildURLHausCard(data.urlhaus);
      if (urlHausCard) {
        const existing = cardsByName.get(urlHausCard.name);
        if (!existing || intelStatusWeight[urlHausCard.status] > intelStatusWeight[existing.status]) {
          cardsByName.set(urlHausCard.name, urlHausCard);
        }
      }
    }

    return Array.from(cardsByName.values()).sort(
      (a, b) => intelStatusWeight[b.status] - intelStatusWeight[a.status]
    );
  }

  function buildURLHausCard(data: any): IntelCard | null {
    const icon = intelIcons.URLHaus || '🌐';
    if (data === null) {
      return {
        name: 'URLHaus',
        icon,
        status: 'error',
        headline: 'Lookup failed',
        detail: 'Unable to check URLHaus database.'
      };
    }
    if (!data || !data.ok) {
      return {
        name: 'URLHaus',
        icon,
        status: 'error',
        headline: 'Lookup failed',
        detail: 'No response from URLHaus.'
      };
    }
    const status = String(data.query_status || '').toLowerCase();
    if (status === 'no_results') {
      return {
        name: 'URLHaus',
        icon,
        status: 'clean',
        headline: 'No listings found',
        detail: 'This URL is not currently flagged by URLHaus.'
      };
    }
    if (status === 'error' || status === 'failed') {
      return {
        name: 'URLHaus',
        icon,
        status: 'error',
        headline: 'Feed error',
        detail: 'URLHaus returned an error. Try again later.'
      };
    }
    if (data.matches && data.matches.length > 0) {
      return {
        name: 'URLHaus',
        icon,
        status: 'block',
        headline: `Reported malicious (${data.matches.length} match${data.matches.length > 1 ? 'es' : ''})`,
        detail: 'This URL is flagged as malicious by URLHaus.'
      };
    }
    return {
      name: 'URLHaus',
      icon,
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
        <img src="/qrcheck.png" alt="QRCheck" class="logo-image" />
        <div class="logo-text">
          <h1>QRCheck.ca</h1>
          <p>Privacy-first QR inspection</p>
        </div>
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
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 1.25rem; height: 1.25rem; color: #60a5fa;">
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

      {#if flaggedChecks.length}
        <div class="check-flags">
          {#each flaggedChecks as check (check.id)}
            <span class={`check-chip ${check.status}`}>
              {statusIcon(check.status)} {check.label}
            </span>
          {/each}
        </div>
      {/if}

      <!-- Content Type Panel -->
      {#if qrContent && showProgressSection === false}
        <section class="content-panel">
          <h3>📋 Content Detected</h3>

          <!-- Content summary card -->
          <div class="content-summary">
            <div class="content-card">
              <div class="content-icon">
                {#if qrContent.type === 'url'}🔗{:else if qrContent.type === 'text'}📝{:else if qrContent.type === 'email'}✉️{:else if qrContent.type === 'phone'}📞{:else if qrContent.type === 'sms'}💬{:else if qrContent.type === 'wifi'}📶{:else if qrContent.type === 'vcard'}👤{:else if qrContent.type === 'geo'}📍{:else}❓{/if}
              </div>
              <div class="content-info">
                <div class="content-type-display">
                  <span class="type-label">Type:</span>
                  <span class="type-value">{qrContent.type || 'unknown'}</span>
                </div>
                <div class="content-text">
                  <span class="content-url">{qrContent.text || 'No content'}</span>
                  {#if qrContent.text && qrContent.text.startsWith('http')}
                    <button
                      class="content-copy-btn"
                      type="button"
                      on:click={() => copyToClipboard(qrContent.text)}
                      title="Copy URL"
                    >
                      {copyFeedback === qrContent.text ? '✅' : '📋'}
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        </section>
      {/if}

      <!-- Enhanced Analysis Results Breakdown -->
      {#if analysisSteps.length > 0 && showProgressSection === false}
        <section class="analysis-results">
          <h3>🔍 Security Analysis Complete</h3>

          <!-- Summary card -->
          <div class="result-summary">
            <div class="summary-card {verdictMetaInfo.tone}">
              <div class="card-icon">
                {verdictMetaInfo.emoji}
              </div>
              <div class="card-content">
                <h4>
                  {#if verdictMetaInfo.tone === 'safe'}✅ Safe to Visit
                  {:else if verdictMetaInfo.tone === 'warn'}⚠️ Proceed with Caution
                  {:else}🚫 Dangerous - Avoid
                  {/if}
                </h4>
                <p>
                  {flaggedChecks.length} {flaggedChecks.length === 1 ? 'issue' : 'issues'} found
                  • {totalAnalysisTime}ms analysis time
                </p>
              </div>
            </div>
          </div>

          <!-- Only show details for non-safe results -->
          {#if verdictMetaInfo.tone !== 'safe'}
            <!-- Detailed breakdown -->
            <details class="analysis-breakdown" open>
              <summary class="breakdown-summary">
                <div class="breakdown-header">
                  <h4>📋 Security Issues Found</h4>
                  <span class="chevron">▼</span>
                </div>
                <span class="breakdown-subtitle">
                  Click to view detailed analysis
                </span>
              </summary>

              <div class="breakdown-content">
                {#each analysisSteps as step}
                  {#if step.status === 'error' || (verdictMetaInfo.tone !== 'safe' && step.status === 'completed')}
                    <div class="result-item" class:warning={step.status === 'error'} class:skipped={step.status === 'skipped'}>
                      <div class="result-status">
                        {step.status === 'completed' ? '✅' : ''}
                        {step.status === 'error' ? '❌' : ''}
                        {step.status === 'skipped' ? '⏭️' : ''}
                        {step.status === 'pending' ? '⏳' : ''}
                      </div>
                      <div class="result-details">
                        <div class="result-header">
                          <span class="result-name">{step.icon} {step.name}</span>
                          {#if step.duration}
                            <span class="result-duration">{step.duration}ms</span>
                          {/if}
                        </div>
                        <div class="result-description">{step.description}</div>

                        {#if step.status === 'error' && step.details}
                          <div class="result-warning">
                            <strong>Issue:</strong> {step.details}
                            <button class="learn-more-btn" on:click={(e) => showInfoTooltip(step.id, e)}>
                              Learn more
                            </button>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            </details>

            <!-- Educational summary (only for non-safe) -->
            <details class="educational-summary" open>
              <summary class="breakdown-summary">
                <div class="breakdown-header">
                  <h4>🎓 What This Means</h4>
                  <span class="chevron">▼</span>
                </div>
                <span class="breakdown-subtitle">
                  Click to learn about these security checks
                </span>
              </summary>

              <div class="educational-content">
                <p>This URL was flagged because of potential security concerns detected during our analysis.</p>

                <div class="security-tips">
                  <h5>🛡️ Security Tips:</h5>
                  <ul>
                    <li>Always verify where shortened URLs really lead before clicking</li>
                    <li>Be cautious of URLs with unusual characters or excessive length</li>
                    <li>Check domain age - newer domains require more scrutiny</li>
                    <li>Look for HTTPS encryption and valid SSL certificates</li>
                    <li>Be wary of urgent language or requests for personal information</li>
                  </ul>
                </div>
              </div>
            </details>
          {:else}
            <!-- Simple safe result -->
            <div class="safe-result">
              <div class="safe-icon">✅</div>
              <div class="safe-content">
                <h4>All Clear!</h4>
                <p>This URL passed all {analysisSteps.filter(s => s.status === 'completed').length} security checks.</p>
              </div>
            </div>
          {/if}
        </section>
      {/if}

      {#if qrContent?.type === 'url' && (redirectCount > 0 || redirectExpansionBlocked)}
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
            <h4>Resolution</h4>
            {#if terminalUrl}
              <div class="resolved-url">
                <span class="url-label">🎯 Final URL:</span>
                <span class="url-value">{terminalUrl}</span>
                <button class="{getCopyButtonClass()}" type="button" on:click={() => copyToClipboard(terminalUrl)} title="Copy final URL">
                  {copyFeedback || '📋 Copy'}
                </button>
              </div>
              <div class={`redirect-summary ${!redirectExpansionBlocked && redirectCount === 0 ? 'single' : ''}`}>
                {#if redirectExpansionBlocked}
                  <span class="redirect-count">⚠️ Redirects blocked</span>
                  <span class="redirect-info">Browser security prevented expanding this shortened link</span>
                {:else if redirectCount > 0}
                  <span class="redirect-count">{redirectCount} redirect{redirectCount > 1 ? 's' : ''}</span>
                  <span class="redirect-info">Shortened link expanded to reveal the destination</span>
                              {/if}
              </div>
            {/if}
          </div>
        </div>
          {/if}

      <details class="drawer" bind:open={checksOpen}>
        <summary>
          <span>See all checks</span>
          <span class="drawer-chevron">▶</span>
        </summary>
        <div class="risk-summary">
          <div class="risk-indicator" style="color: {formattedHeuristics.riskColor}">
            {formattedHeuristics.riskText}
          </div>
          <div class="risk-score">{formattedHeuristics.summary}</div>
        </div>

        {#if formattedHeuristics.issues.length}
          <ul class="risk-issues">
            {#each formattedHeuristics.issues as issue (issue.id)}
              <li class={`risk-issue ${issue.severity}`}>
                <span class="issue-label">{issue.label}</span>
                {#if issue.detail}
                  <span class="issue-detail">{issue.detail}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="no-issues">No issues detected in the latest scan.</p>
        {/if}

        {#if formattedHeuristics.checks.length}
          <h4 class="checks-title">Checks completed</h4>
          <div class="checks-grid">
            {#each formattedHeuristics.checks as check (check.id)}
              <div class={`check-row ${check.status}`}>
                <span class="check-label">{statusIcon(check.status)} {check.label}</span>
                {#if check.detail}
                  <span class="check-detail">{check.detail}</span>
                {/if}
              </div>
            {/each}
          </div>
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
          <summary>
            <span>📊 Redirect Chain ({hops.length} hops)</span>
            <span class="drawer-chevron">▶</span>
          </summary>
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
          <summary>
            <span>Threat intel</span>
            <span class="drawer-chevron">▶</span>
          </summary>
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

      <details class="drawer" bind:open={learnMoreOpen}>
        <summary>
          <span>{learnMoreOpen ? 'Hide Learn More' : 'Learn more about these checks'}</span>
          <span class="drawer-chevron">▶</span>
        </summary>
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
      </details>
    </section>
  {:else if flow === 'processing'}
    <!-- Enhanced Progress Section -->
    <section class="analysis-progress" class:active={showProgressSection} aria-live="polite" on:click={handleClickOutside}>
      <h3>🔍 Security Analysis in Progress</h3>

      <!-- Overall progress bar -->
      <div class="overall-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: {overallProgress}%"></div>
        </div>
        <span class="progress-text">{overallProgress}% Complete</span>
        {#if estimatedTimeRemaining > 0}
          <span class="time-remaining">~{estimatedTimeRemaining}s remaining</span>
        {/if}
      </div>

      <!-- Individual steps -->
      <div class="analysis-steps">
        {#each analysisSteps as step, index}
          <div
            class="analysis-step"
            class:active={step.status === 'running'}
            class:completed={step.status === 'completed'}
            class:error={step.status === 'error'}
            class:skipped={step.status === 'skipped'}
            role="status"
            aria-label="{step.name}: {step.status}"
          >
            <div class="step-icon">
              {step.status === 'pending' ? '⏳' : ''}
              {step.status === 'running' ? '🔄' : ''}
              {step.status === 'completed' ? '✅' : ''}
              {step.status === 'error' ? '❌' : ''}
              {step.status === 'skipped' ? '⏭️' : ''}
            </div>

            <div class="step-content">
              <div class="step-header">
                <span class="step-name">{step.icon} {step.name}</span>
                {#if step.duration}
                  <span class="step-duration">{step.duration}ms</span>
                {/if}
              </div>

              <div class="step-description">{step.description}</div>

              {#if step.details}
                <div class="step-details">{step.details}</div>
              {/if}

              <!-- Info icon with tooltip -->
              <button
                class="info-button"
                on:click={(e) => showInfoTooltip(step.id, e)}
                aria-label="Learn more about {step.name}"
                type="button"
              >
                ℹ️
              </button>
            </div>
          </div>
        {/each}
      </div>
    </section>

    <!-- Educational Tooltip -->
    {#if activeTooltip}
      {@const step = analysisSteps.find(s => s.id === activeTooltip)}
      {#if step}
        <div
          class="info-tooltip active"
          style="left: {tooltipPosition.x}px; top: {tooltipPosition.y}px"
          role="tooltip"
          aria-labelledby="tooltip-title-{step.id}"
          on:click|stopPropagation
        >
          <div class="tooltip-content">
            <h4 id="tooltip-title-{step.id}">{step.icon} {step.name}</h4>

            <div class="info-sections">
              <div class="info-section">
                <h5>🎯 What This Checks</h5>
                <p>{step.educationalInfo.what}</p>
              </div>

              <div class="info-section">
                <h5>⚠️ Why It Matters</h5>
                <p>{step.educationalInfo.why}</p>
              </div>

              <div class="info-section">
                <h5>🔧 How It Works</h5>
                <p>{step.educationalInfo.how}</p>
              </div>

              <!-- Real-time status -->
              {#if step.status === 'running'}
                <div class="info-section status">
                  <h5>🔄 Current Status</h5>
                  <p>Currently performing this check...</p>
                </div>
              {:else if step.status === 'completed'}
                <div class="info-section status">
                  <h5>✅ Check Complete</h5>
                  <p>This check completed successfully {step.duration ? `in ${step.duration}ms` : ''}</p>
                </div>
              {:else if step.status === 'error'}
                <div class="info-section status error">
                  <h5>❌ Check Failed</h5>
                  <p>{step.details}</p>
                </div>
              {/if}
            </div>

            <button class="tooltip-close" on:click={hideInfoTooltip} type="button">
              Got it! ✓
            </button>
          </div>
        </div>
      {/if}
    {/if}
  {:else if flow === 'error' && step}
    <!-- Error State with Progress Section -->
    <section class="analysis-progress error active" aria-live="polite">
      <h3>❌ Analysis Failed</h3>

      <div class="error-summary">
        <div class="error-icon">❌</div>
        <div class="error-content">
          <h4>{step}</h4>
          {#if error}
            <p class="error-message">{error}</p>
          {/if}
        </div>
      </div>

      <!-- Show analysis steps that were attempted -->
      {#if analysisSteps.some(s => s.status !== 'pending')}
        <div class="analysis-steps">
          <h4>Attempted Checks:</h4>
          {#each analysisSteps as step, index}
            {#if step.status !== 'pending'}
              <div
                class="analysis-step"
                class:completed={step.status === 'completed'}
                class:error={step.status === 'error'}
                role="status"
                aria-label="{step.name}: {step.status}"
              >
                <div class="step-icon">
                  {step.status === 'completed' ? '✅' : '❌'}
                </div>
                <div class="step-content">
                  <div class="step-header">
                    <span class="step-name">{step.icon} {step.name}</span>
                  </div>
                  <div class="step-description">{step.description}</div>
                  {#if step.status === 'error' && step.details}
                    <div class="step-error">{step.details}</div>
                  {/if}
                </div>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
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
  
  .risk-issues {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .risk-issue {
    padding: 0.75rem;
    border-radius: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .risk-issue.fail {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.15);
  }

  .risk-issue.warn {
    border-color: rgba(245, 158, 11, 0.4);
    background: rgba(245, 158, 11, 0.15);
  }

  .issue-label {
    font-weight: 600;
    color: white;
  }

  .issue-detail {
    color: var(--text-secondary);
    font-size: 0.875rem;
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

  .check-flags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .check-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: 999px;
    padding: 0.35rem 0.75rem;
    font-size: 0.75rem;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .check-chip.fail {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.4);
  }

  .check-chip.warn {
    background: rgba(245, 158, 11, 0.2);
    border-color: rgba(245, 158, 11, 0.4);
  }

  .check-chip.info {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.35);
  }

  .checks-title {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 1rem 0 0.5rem;
    color: var(--text-primary);
  }

  .checks-grid {
    display: grid;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .check-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .check-row.fail {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.12);
  }

  .check-row.warn {
    border-color: rgba(245, 158, 11, 0.4);
    background: rgba(245, 158, 11, 0.12);
  }

  .check-row.info {
    border-color: rgba(148, 163, 184, 0.4);
  }

  .check-label {
    font-weight: 600;
    color: white;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .check-detail {
    color: var(--text-secondary);
    font-size: 0.85rem;
    flex: 1;
    text-align: right;
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

  /* Transparent Analysis System Styles */
  .analysis-progress {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 12px;
    padding: 24px;
    color: white;
    margin: 20px 0;
    box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    position: relative;
    opacity: 0;
    transform: translateY(20px);
    transition: all 0.3s ease;
  }

  .analysis-progress.active {
    opacity: 1;
    transform: translateY(0);
  }

  .analysis-progress h3 {
    margin: 0 0 20px 0;
    font-size: 1.25rem;
    font-weight: 600;
    text-align: center;
  }

  .analysis-progress.error {
    background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
  }

  .error-summary {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 24px;
    padding: 20px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    border-left: 4px solid rgba(255, 255, 255, 0.3);
  }

  .error-icon {
    font-size: 2rem;
    flex-shrink: 0;
  }

  .error-content h4 {
    margin: 0 0 12px 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .error-message {
    margin: 0;
    line-height: 1.5;
    opacity: 0.9;
  }

  .step-error {
    margin-top: 8px;
    padding: 8px 12px;
    background: rgba(220, 38, 38, 0.2);
    border-radius: 4px;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.9);
    border-left: 3px solid rgba(255, 255, 255, 0.3);
  }

  .overall-progress {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .progress-bar {
    flex: 1;
    min-width: 200px;
    height: 8px;
    background: rgba(255,255,255,0.2);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e, #10b981);
    transition: width 0.3s ease;
    border-radius: 4px;
    position: relative;
  }

  .progress-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
    animation: shimmer 2s infinite;
  }

  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  .progress-text, .time-remaining {
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .time-remaining {
    opacity: 0.8;
    font-size: 0.8rem;
  }

  .analysis-steps {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .analysis-step {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: rgba(255,255,255,0.1);
    border-radius: 8px;
    backdrop-filter: blur(10px);
    transition: all 0.3s ease;
    border: 1px solid rgba(255,255,255,0.1);
  }

  .analysis-step:hover {
    background: rgba(255,255,255,0.15);
    transform: translateX(4px);
  }

  .analysis-step.active {
    background: rgba(255,255,255,0.2);
    transform: translateX(4px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    border-color: rgba(255,255,255,0.3);
  }

  .analysis-step.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: linear-gradient(to bottom, #22c55e, #10b981);
    border-radius: 8px 0 0 8px;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  .analysis-step.completed {
    opacity: 0.9;
  }

  .analysis-step.error {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.3);
  }

  .analysis-step.skipped {
    opacity: 0.6;
  }

  .step-icon {
    font-size: 20px;
    min-width: 24px;
    text-align: center;
    line-height: 1;
  }

  .step-content {
    flex: 1;
    min-width: 0;
  }

  .step-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .step-name {
    font-weight: 500;
    font-size: 0.9rem;
  }

  .step-duration {
    font-size: 0.75rem;
    opacity: 0.7;
    background: rgba(255,255,255,0.1);
    padding: 2px 6px;
    border-radius: 10px;
  }

  .step-description {
    font-size: 0.8rem;
    opacity: 0.9;
    line-height: 1.4;
    margin-bottom: 4px;
  }

  .step-details {
    font-size: 0.8rem;
    opacity: 0.8;
    font-style: italic;
    margin-bottom: 8px;
  }

  .info-button {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.2s ease;
    color: rgba(255,255,255,0.9);
    font-size: 0.8rem;
    margin-top: 4px;
  }

  .info-button:hover {
    background: rgba(255,255,255,0.2);
    color: white;
    transform: scale(1.05);
  }

  .info-button:active {
    transform: scale(0.95);
  }

  /* Tooltip Styles */
  .info-tooltip {
    position: fixed;
    background: white;
    color: #333;
    border-radius: 12px;
    padding: 0;
    box-shadow: 0 12px 48px rgba(0,0,0,0.2);
    max-width: 400px;
    z-index: 1000;
    opacity: 0;
    transform: translateY(-10px) scale(0.95);
    transition: all 0.3s ease;
    pointer-events: none;
    border: 1px solid rgba(0,0,0,0.1);
  }

  .info-tooltip.active {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .tooltip-content {
    padding: 20px;
  }

  .tooltip-content h4 {
    margin: 0 0 16px 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: #1f2937;
    border-bottom: 2px solid #e5e7eb;
    padding-bottom: 8px;
  }

  .info-sections {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .info-section {
    margin: 0;
  }

  .info-section h5 {
    margin: 0 0 4px 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: #374151;
  }

  .info-section p {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.4;
    color: #6b7280;
  }

  .info-section.status {
    background: #f3f4f6;
    padding: 8px;
    border-radius: 6px;
    border-left: 4px solid #3b82f6;
  }

  .info-section.status.error {
    border-left-color: #ef4444;
    background: #fef2f2;
  }

  .info-section.status h5 {
    color: #1f2937;
  }

  .tooltip-close {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    margin-top: 16px;
    font-weight: 500;
    font-size: 0.9rem;
    transition: background-color 0.2s ease;
    width: 100%;
  }

  .tooltip-close:hover {
    background: #2563eb;
  }

  .tooltip-close:active {
    transform: scale(0.98);
  }

  /* Mobile Optimizations */
  @media (max-width: 768px) {
    .analysis-progress {
      margin: 16px -16px;
      border-radius: 0;
      padding: 20px 16px;
    }

    .overall-progress {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
    }

    .progress-bar {
      min-width: auto;
    }

    .progress-text, .time-remaining {
      text-align: center;
    }

    .analysis-step {
      padding: 10px;
    }

    .step-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }

    .step-name {
      font-size: 0.85rem;
    }

    .step-description {
      font-size: 0.75rem;
    }

    .info-tooltip {
      position: fixed;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) scale(0.95) !important;
      max-width: 90vw;
      max-height: 80vh;
      overflow-y: auto;
    }

    .info-tooltip.active {
      transform: translate(-50%, -50%) scale(1) !important;
    }

    .tooltip-content {
      padding: 16px;
    }

    .tooltip-content h4 {
      font-size: 1rem;
    }
  }

  /* Enhanced Results Display Styles */
  .analysis-results {
    background: var(--bg-primary);
    border-radius: 12px;
    padding: 24px;
    margin: 20px 0;
    border: 1px solid var(--border-color);
    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  }

  .analysis-results h3 {
    margin: 0 0 20px 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
    text-align: center;
  }

  .content-panel {
    background: var(--bg-primary);
    border-radius: 12px;
    padding: 24px;
    margin: 20px 0;
    border: 1px solid var(--border-color);
    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  }

  .content-panel h3 {
    margin: 0 0 20px 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
    text-align: center;
  }

  .content-summary {
    margin-bottom: 0;
  }

  .content-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: linear-gradient(135deg, #065f46 0%, #047857 100%);
    border-color: #10b981;
    transition: all 0.3s ease;
    color: white;
  }

  .content-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(16, 185, 129, 0.3);
  }

  .content-icon {
    font-size: 2rem;
    line-height: 1;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
    flex-shrink: 0;
  }

  .content-info {
    flex: 1;
    min-width: 0;
  }

  .content-type-display {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  .content-type-display .type-label {
    font-size: 0.8rem;
    opacity: 0.8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .content-type-display .type-value {
    font-size: 0.9rem;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.15);
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .content-text {
    font-size: 0.95rem;
    line-height: 1.4;
    opacity: 0.9;
    word-break: break-all;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .content-url {
    flex: 1;
    min-width: 0;
  }

  .content-copy-btn {
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 4px 8px;
    color: white;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s ease;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 28px;
  }

  .content-copy-btn:hover {
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.5);
    transform: translateY(-1px);
  }

  .content-copy-btn:active {
    transform: translateY(0);
  }

  .result-summary {
    margin-bottom: 24px;
  }

  .summary-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    transition: all 0.3s ease;
  }

  .summary-card.safe {
    background: linear-gradient(135deg, #065f46 0%, #047857 100%);
    border-color: #10b981;
  }

  .summary-card.warn {
    background: linear-gradient(135deg, #92400e 0%, #b45309 100%);
    border-color: #f59e0b;
  }

  .summary-card.danger {
    background: linear-gradient(135deg, #991b1b 0%, #dc2626 100%);
    border-color: #ef4444;
  }

  .card-icon {
    font-size: 2rem;
    line-height: 1;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
  }

  .card-content {
    flex: 1;
  }

  .card-content h4 {
    margin: 0 0 4px 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.1);
  }

  .card-content p {
    margin: 0 0 8px 0;
    font-size: 0.9rem;
    color: #f3f4f6;
    font-weight: 400;
  }

  /* Removed summary-stats for simpler layout */

  .analysis-breakdown {
    margin-bottom: 24px;
  }

  .breakdown-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.2s ease;
    border: 1px solid var(--border-color);
    list-style: none;
  }

  .breakdown-summary:hover {
    background: var(--bg-tertiary);
  }

  .breakdown-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .breakdown-summary h4 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .chevron {
    font-size: 1rem;
    color: var(--text-secondary);
    transition: transform 0.2s ease;
  }

  details[open] .chevron {
    transform: rotate(180deg);
  }

  .drawer-chevron {
    font-size: 0.8rem;
    color: var(--text-secondary);
    transition: transform 0.2s ease;
    margin-left: auto;
  }

  details[open] .drawer-chevron {
    transform: rotate(90deg);
  }

  
  
  .drawer summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    list-style: none;
    user-select: none;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    margin-bottom: 8px;
    transition: background-color 0.2s ease;
  }

  .drawer summary:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .drawer summary::-webkit-details-marker {
    display: none;
  }

  .drawer summary::marker {
    display: none;
  }

  .breakdown-subtitle {
    font-size: 0.8rem;
    color: var(--text-secondary);
    grid-column: 1 / -1;
  }

  .breakdown-content {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: 6px;
    border: 1px solid var(--border-color);
    transition: all 0.2s ease;
  }

  .result-item:hover {
    background: var(--bg-tertiary);
    transform: translateX(2px);
  }

  .result-item.warning {
    background: #fef2f2;
    border-color: #fecaca;
  }

  .result-item.skipped {
    opacity: 0.6;
  }

  .result-status {
    font-size: 1.1rem;
    min-width: 20px;
    text-align: center;
    line-height: 1;
  }

  .result-details {
    flex: 1;
  }

  .result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .result-name {
    font-weight: 500;
    font-size: 0.9rem;
    color: var(--text-primary);
  }

  .result-duration {
    font-size: 0.75rem;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: 10px;
  }

  .result-description {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 8px;
    line-height: 1.4;
  }

  .result-warning {
    background: #7f1d1d;
    padding: 8px;
    border-radius: 4px;
    border-left: 3px solid #ef4444;
    margin-bottom: 8px;
  }

  .result-warning strong {
    color: #fca5a5;
    display: block;
    margin-bottom: 4px;
  }

  .result-warning .learn-more-btn {
    color: #fca5a5;
    border-color: #991b1b;
  }

  .result-warning .learn-more-btn:hover {
    background: #991b1b;
    color: #ffffff;
  }

  .result-success {
    background: #14532d;
    padding: 8px;
    border-radius: 4px;
    border-left: 3px solid #22c55e;
    margin-bottom: 8px;
  }

  .success-text {
    color: #86efac;
    font-weight: 500;
    display: block;
    margin-bottom: 4px;
  }

  .result-success .learn-more-btn {
    color: #86efac;
    border-color: #166534;
  }

  .result-success .learn-more-btn:hover {
    background: #166534;
    color: #ffffff;
  }

  .learn-more-btn {
    background: none;
    border: 1px solid var(--border-color);
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75rem;
    transition: all 0.2s ease;
    color: var(--text-primary);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }

  .learn-more-btn:hover {
    background: var(--bg-tertiary);
    transform: scale(1.05);
    text-decoration-style: solid;
  }

  .safe-result {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    background: linear-gradient(135deg, #065f46 0%, #047857 100%);
    border-radius: 8px;
    border: 1px solid #10b981;
    margin-top: 16px;
  }

  .safe-icon {
    font-size: 2.5rem;
    line-height: 1;
  }

  .safe-content h4 {
    margin: 0 0 8px 0;
    font-size: 1.2rem;
    font-weight: 600;
    color: #ffffff;
  }

  .safe-content p {
    margin: 0 0 12px 0;
    font-size: 0.9rem;
    color: #f3f4f6;
  }

  .safe-content .learn-more-btn {
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.3);
    color: #ffffff;
  }

  .safe-content .learn-more-btn:hover {
    background: rgba(255,255,255,0.3);
  }

  .educational-summary {
    background: var(--bg-secondary);
    padding: 20px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }

  .educational-content {
    padding-top: 16px;
  }

  .educational-summary h4 {
    margin: 0 0 12px 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .educational-summary p {
    margin: 0 0 16px 0;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .analysis-highlights,
  .security-tips,
  .analysis-metrics {
    margin: 16px 0;
  }

  .analysis-highlights h5,
  .security-tips h5,
  .analysis-metrics h5 {
    margin: 0 0 8px 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .analysis-highlights ul,
  .security-tips ul {
    margin: 0;
    padding-left: 20px;
    color: var(--text-secondary);
  }

  .analysis-highlights li,
  .security-tips li {
    margin-bottom: 4px;
    line-height: 1.4;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
  }

  .metric {
    background: var(--bg-primary);
    padding: 12px;
    border-radius: 6px;
    text-align: center;
    border: 1px solid var(--border-color);
  }

  .metric-value {
    display: block;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  /* Enhanced risk score display */
  .score-chip {
    background: var(--bg-primary);
    border: 2px solid var(--border-color);
    border-radius: 12px;
    padding: 16px 20px;
    text-align: center;
    min-width: 120px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    transition: all 0.3s ease;
  }

  .score-chip:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0,0,0,0.15);
  }

  .score-value {
    display: block;
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    margin-bottom: 4px;
  }

  .score-label {
    font-size: 0.8rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 500;
  }

  .metric-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Mobile Optimizations for Results */
  @media (max-width: 768px) {
    .analysis-results {
      margin: 16px -16px;
      border-radius: 0;
      padding: 20px 16px;
    }

    .summary-card {
      flex-direction: column;
      text-align: center;
      gap: 12px;
    }

    .content-panel {
      margin: 16px -16px;
      border-radius: 0;
      padding: 20px 16px;
    }

    .content-card {
      flex-direction: column;
      text-align: center;
      gap: 12px;
    }

    .content-type-display {
      justify-content: center;
    }

    .breakdown-summary {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }

    .result-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }

    .metrics-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .metric {
      padding: 8px;
    }

    .metric-value {
      font-size: 1rem;
    }

    .score-chip {
      padding: 12px 16px;
      min-width: 100px;
    }

    .score-value {
      font-size: 2rem;
    }
  }

  /* Dark theme adjustments */
  @media (prefers-color-scheme: dark) {
    .info-tooltip {
      background: #1f2937;
      color: #f9fafb;
      border-color: rgba(255,255,255,0.1);
    }

    .tooltip-content h4 {
      color: #f9fafb;
      border-bottom-color: #374151;
    }

    .info-section h5 {
      color: #e5e7eb;
    }

    .info-section p {
      color: #d1d5db;
    }

    .info-section.status {
      background: #374151;
      border-left-color: #3b82f6;
    }

    .info-section.status.error {
      background: #450a0a;
      border-left-color: #ef4444;
    }

    .card-content h4 {
      color: #ffffff;
    }

    .card-content p {
      color: #f3f4f6;
    }

    .educational-summary p {
      color: #d1d5db;
    }

    .analysis-highlights li,
    .security-tips li {
      color: #d1d5db;
    }
  }
</style>
