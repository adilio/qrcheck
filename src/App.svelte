<script lang="ts">
  import { onMount } from 'svelte';
  import { analyzeUrl } from './lib/heuristics';
  import { cameraReadyHint, ensureCameraAccess } from './lib/camera';
  import { STRINGS } from './lib/strings';
  import type { UrlAnalysisResult } from './types';

  type FlowState = 'idle' | 'processing' | 'done' | 'error';

  let flow: FlowState = 'idle';
  let urlInput = '';
  let displayLabel = '';
  let analysis: UrlAnalysisResult | null = null;
  let errorMessage = '';
  let showPath = false;
  let showReasons = true;
  let hint: 'ready' | 'ask' | 'blocked' = 'ask';
  let lastCheckedUrl = '';
  let finalHost = '';
  let finalPath = '';

  $: redirectCount = analysis ? Math.max(0, analysis.redirect_chain.length - 1) : 0;
  $: pathPreview = analysis
    ? `${analysis.redirect_chain[0] ?? ''} → … → ${
        analysis.redirect_chain[analysis.redirect_chain.length - 1] ?? ''
      }`
    : '';
  $: if (analysis) {
    try {
      const parsed = new URL(analysis.final_url);
      finalHost = parsed.hostname;
      finalPath = parsed.pathname;
    } catch {
      finalHost = analysis.final_url;
      finalPath = '';
    }
  } else {
    finalHost = '';
    finalPath = '';
  }

  onMount(async () => {
    hint = await cameraReadyHint();
  });

  function togglePath() {
    showPath = !showPath;
  }

  function toggleReasons() {
    showReasons = !showReasons;
  }

  async function requestCamera() {
    try {
      await ensureCameraAccess();
      hint = 'ready';
    } catch (error) {
      hint = 'blocked';
      errorMessage = error instanceof Error ? error.message : STRINGS.camera.failure;
    }
  }

  function displayHostMismatch(): string | null {
    if (!analysis || !displayLabel) return null;
    try {
      const labelHost = new URL(displayLabel).hostname.toLowerCase();
      const finalHost = new URL(analysis.final_url).hostname.toLowerCase();
      if (labelHost && finalHost && labelHost !== finalHost && !finalHost.endsWith(`.${labelHost}`)) {
        return `${labelHost} → ${finalHost}`;
      }
    } catch {
      return null;
    }
    return null;
  }

  async function runAnalysis(bypassCache = false) {
    if (!urlInput.trim()) {
      errorMessage = STRINGS.inputs.emptyError;
      return;
    }
    flow = 'processing';
    errorMessage = '';
    analysis = null;
    lastCheckedUrl = urlInput.trim();

    let labelHost: string | undefined;
    if (displayLabel.trim()) {
      try {
        const parsed = new URL(displayLabel.trim());
        labelHost = parsed.hostname;
      } catch {
        labelHost = undefined;
      }
    }

    try {
      analysis = await analyzeUrl(urlInput.trim(), { bypassCache, labelHost });
      flow = 'done';
    } catch (error) {
      analysis = null;
      flow = 'error';
      errorMessage = error instanceof Error ? error.message : STRINGS.inputs.analysisError;
    }
  }

  function verdictTone(verdict: UrlAnalysisResult['verdict']) {
    return STRINGS.verdict[verdict];
  }

  function redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.toString();
    } catch {
      return url;
    }
  }

  function copyFinalUrl() {
    if (!analysis) return;
    navigator.clipboard?.writeText(analysis.final_url).catch(() => {
      errorMessage = STRINGS.inputs.copyError;
    });
  }
</script>

<main class="app">
  <header class="hero">
    <h1>{STRINGS.hero.title}</h1>
    <p>{STRINGS.hero.tagline}</p>
  </header>

  <section class="input-panel">
    <div class="camera-hint" data-state={hint}>
      {#if hint === 'ready'}
        <span>{STRINGS.camera.ready}</span>
      {:else if hint === 'blocked'}
        <span>{STRINGS.camera.blocked}</span>
      {:else}
        <span>{STRINGS.camera.ask}</span>
      {/if}
      <button type="button" on:click={requestCamera}>{STRINGS.camera.openButton}</button>
    </div>

    <label>
      <span class="label">{STRINGS.inputs.destinationLabel}</span>
      <input
        type="url"
        placeholder={STRINGS.inputs.destinationPlaceholder}
        bind:value={urlInput}
        aria-label="URL to analyze"
      />
    </label>

    <label>
      <span class="label">{STRINGS.inputs.displayLabel}</span>
      <input
        type="url"
        placeholder={STRINGS.inputs.displayPlaceholder}
        bind:value={displayLabel}
        aria-label="Display text domain"
      />
    </label>

    <div class="actions">
      <button type="button" class="primary" on:click={() => runAnalysis(false)} disabled={flow === 'processing'}>
        {flow === 'processing' ? STRINGS.inputs.analyzingButton : STRINGS.inputs.analyzeButton}
      </button>
      {#if analysis}
        <button type="button" on:click={() => runAnalysis(true)}>{STRINGS.inputs.recheckButton}</button>
      {/if}
    </div>

    {#if errorMessage}
      <p class="error" role="alert">{errorMessage}</p>
    {/if}
  </section>

  {#if analysis}
    <section class="result-card" data-verdict={analysis.verdict}>
      {#if analysis.expansion_failure}
        <div class="banner warn">{STRINGS.result.banner}</div>
      {/if}

      <header>
        <div class="verdict-chip">
          <span aria-hidden="true">{verdictTone(analysis.verdict).emoji}</span>
          <strong>{verdictTone(analysis.verdict).title}</strong>
        </div>
        <p>{verdictTone(analysis.verdict).guidance}</p>
      </header>

      <div class="score-line">
        <span>{STRINGS.result.riskLabel}</span>
        <strong>{analysis.score}</strong>
      </div>

      <div class="url-summary">
        <div>
          <span class="label">{STRINGS.result.originalLabel}</span>
          <code>{redactUrl(lastCheckedUrl)}</code>
        </div>
        <div>
          <span class="label">{STRINGS.result.expandedLabel}</span>
          <code>
            <strong>{finalHost}</strong>
            {finalPath}
          </code>
          <button type="button" on:click={copyFinalUrl}>{STRINGS.result.copyFinal}</button>
        </div>
      </div>

      <div class="link-path">
        <button type="button" on:click={togglePath}>
          {STRINGS.result.linkPath} ({redirectCount} redirects)
          <span aria-hidden="true">{showPath ? '▾' : '▸'}</span>
        </button>
        {#if showPath}
          <ol>
            {#each analysis.redirect_chain as hop, index}
              <li>
                <span class="hop-label">
                  {index === 0
                    ? STRINGS.result.hopOriginal
                    : index === analysis.redirect_chain.length - 1
                    ? STRINGS.result.hopFinal
                    : `Hop ${index}`}
                </span>
                <code>{hop}</code>
              </li>
            {/each}
          </ol>
        {:else}
          <p>{pathPreview}</p>
        {/if}
      </div>

      {#if showReasons}
        <ul class="reasons">
          {#each analysis.reasons as reason}
            <li>{reason}</li>
          {/each}
          {#if displayHostMismatch()}
            <li>{STRINGS.result.displayMismatch}: {displayHostMismatch()}</li>
          {/if}
        </ul>
      {:else}
        <button type="button" on:click={toggleReasons}>{STRINGS.result.expandSummary}</button>
      {/if}
      {#if showReasons}
        <button type="button" on:click={toggleReasons}>{STRINGS.result.collapseSummary}</button>
      {/if}

      {#if analysis.warnings.length}
        <div class="warnings">
          {#each analysis.warnings as warning}
            <p>⚠️ {warning}</p>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</main>

<style>
  :global(body) {
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    margin: 0;
    background: var(--surface, #0f172a);
    color: #e2e8f0;
  }

  .app {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .hero h1 {
    font-size: 2.5rem;
    margin-bottom: 0.25rem;
  }

  .hero p {
    margin: 0;
    max-width: 32rem;
    color: #94a3b8;
  }

  .input-panel {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.1);
    padding: 1.5rem;
    border-radius: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .camera-hint {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    gap: 0.75rem;
  }

  .camera-hint[data-state='blocked'] {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.2);
  }

  .camera-hint button {
    background: rgba(59, 130, 246, 0.2);
    border: none;
    color: #bfdbfe;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    cursor: pointer;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .label {
    font-size: 0.875rem;
    color: #94a3b8;
  }

  input[type='url'] {
    width: 100%;
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(15, 23, 42, 0.6);
    color: inherit;
  }

  input[type='url']:focus-visible {
    outline: 2px solid #38bdf8;
    outline-offset: 2px;
  }

  .actions {
    display: flex;
    gap: 0.75rem;
  }

  button.primary {
    background: linear-gradient(135deg, #38bdf8, #6366f1);
    color: white;
    border: none;
    border-radius: 0.75rem;
    padding: 0.75rem 1.5rem;
    cursor: pointer;
    font-weight: 600;
  }

  button {
    background: rgba(148, 163, 184, 0.15);
    color: inherit;
    border: none;
    border-radius: 0.75rem;
    padding: 0.5rem 1rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    color: #fda4af;
    margin: 0;
  }

  .result-card {
    background: rgba(15, 23, 42, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 1rem;
    padding: 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .result-card[data-verdict='block'] {
    border-color: rgba(248, 113, 113, 0.6);
  }

  .result-card[data-verdict='warn'] {
    border-color: rgba(251, 191, 36, 0.5);
  }

  .banner.warn {
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.3);
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    color: #facc15;
  }

  .verdict-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.25rem;
  }

  .score-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 1.125rem;
  }

  .url-summary {
    display: grid;
    gap: 1rem;
  }

  .url-summary code {
    display: block;
    overflow-wrap: anywhere;
    color: #bfdbfe;
  }

  .link-path {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .link-path button {
    align-self: flex-start;
  }

  .link-path ol {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.75rem;
  }

  .link-path li {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .hop-label {
    font-size: 0.75rem;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .reasons {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.5rem;
  }

  .reasons li {
    background: rgba(148, 163, 184, 0.12);
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
  }

  .warnings {
    display: grid;
    gap: 0.5rem;
    color: #fbbf24;
  }

  @media (max-width: 640px) {
    .actions {
      flex-direction: column;
    }

    button {
      width: 100%;
    }

    .camera-hint {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
