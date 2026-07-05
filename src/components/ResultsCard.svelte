<script lang="ts">
  // Transitions removed due to CSP violations causing crashes
  // import { fade, slide } from 'svelte/transition';
  // import { cubicOut } from 'svelte/easing';

  export let verdict: 'safe' | 'caution' | 'danger' | 'analyzing';
  export let finalUrl: string = '';
  export let redirectChain: string[] = [];
  export let redirectPartial: boolean = false;
  export let tier1Complete: boolean = false;
  export let tier2Complete: boolean = false;
  export let tier3Complete: boolean = false;
  export let tier1Checks: Array<{label: string; status: 'pass' | 'warn' | 'fail'; detail?: string}> = [];
  export let tier2Checks: Array<{label: string; status: 'pass' | 'warn' | 'fail' | 'loading'; detail?: string}> = [];
  export let tier3Checks: Array<{label: string; status: 'pass' | 'warn' | 'fail' | 'loading'; detail?: string}> = [];

  $: verdictConfig = {
    safe: {
      emoji: '🔒',
      text: 'LOW RISK',
      message: 'This URL appears safe to visit',
      bgColor: '#e8f5e9',
      textColor: '#2e7d32',
      borderColor: '#66bb6a'
    },
    caution: {
      emoji: '⚠️',
      text: 'MEDIUM RISK',
      message: 'Exercise caution with this URL',
      bgColor: '#fff3e0',
      textColor: '#e65100',
      borderColor: '#ffa726'
    },
    danger: {
      emoji: '🚫',
      text: 'HIGH RISK',
      message: 'Do not visit this URL',
      bgColor: '#ffebee',
      textColor: '#c62828',
      borderColor: '#ef5350'
    },
    analyzing: {
      emoji: '🔍',
      text: 'ANALYZING',
      message: 'Security analysis in progress...',
      bgColor: '#e3f2fd',
      textColor: '#1565c0',
      borderColor: '#42a5f5'
    }
  };

  $: config = verdictConfig[verdict];
  $: allChecksComplete = tier1Complete && tier2Complete && tier3Complete;
  $: showSpinner = verdict === 'analyzing' || !tier1Complete;

  // Continue-to-site (verdict-gated): a safe verdict gets a normal open
  // button; a flagged verdict never one-click-launches — copy is primary and
  // opening requires an explicit second confirmation step.
  let confirmOpen = false;
  let copiedUrl = false;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  $: if (finalUrl || verdict) {
    // Reset the confirm step whenever the analyzed URL or verdict changes
    confirmOpen = false;
  }

  async function copyFinalUrl() {
    try {
      await navigator.clipboard.writeText(finalUrl);
      copiedUrl = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedUrl = false), 2000);
    } catch (_e) {
      // Clipboard unavailable (permissions/insecure context) — leave the URL visible for manual copy
    }
  }
</script>

<div class="results-card">
  <!-- Verdict Banner -->
  <div
    class="verdict-banner"
    style="background-color: {config.bgColor}; color: {config.textColor}; border-color: {config.borderColor}"
  >
    <div class="verdict-content">
      <span class="verdict-emoji">{config.emoji}</span>
      <div class="verdict-text">
        <div class="verdict-title">{config.text}</div>
        <div class="verdict-message">{config.message}</div>
      </div>
      {#if showSpinner}
        <div class="spinner">
          <div class="spinner-circle"></div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Redirect Chain (if applicable) -->
  {#if redirectChain.length > 1}
    <div class="section redirect-section">
      <h4 class="section-title">
        🔗 Redirect Chain ({redirectChain.length - 1} {redirectChain.length === 2 ? 'hop' : 'hops'})
        {#if redirectPartial}
          <span class="status-badge warn">⚠️ May be incomplete</span>
        {/if}
      </h4>
      <div class="redirect-tree">
        {#each redirectChain as hop, i}
          <div
            class="redirect-hop"
            style="padding-left: {i * 16}px"
          >
            {#if i === redirectChain.length - 1}
              <span class="hop-icon">└→</span>
              <span class="hop-url final">{hop}</span>
              <span class="hop-badge final">✓</span>
            {:else}
              <span class="hop-icon">├─</span>
              <span class="hop-url">{hop}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Tier 1: Quick Checks (Instant) -->
  {#if tier1Complete}
    <div class="section">
      <h4 class="section-title">
        ⚡ Quick Checks
        <span class="status-badge {tier1Checks.every(c => c.status === 'pass') ? 'pass' : 'warn'}">
          {tier1Checks.every(c => c.status === 'pass') ? '✓ All Passed' : '⚠️ Issues Found'}
        </span>
      </h4>
      <div class="checks-list">
        {#each tier1Checks as check, i (check.label + check.status)}
          <div
            class="check-item {check.status}"
          >
            <span class="check-icon">
              {#if check.status === 'pass'}✓{:else if check.status === 'warn'}⚠️{:else}✗{/if}
            </span>
            <span class="check-label">{check.label}</span>
            {#if check.detail}
              <span class="check-detail">{check.detail}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Tier 2: Fast Checks (Cached) — URL payloads only -->
  {#if tier1Complete && tier2Checks.length > 0}
    <div class="section">
      <h4 class="section-title">
        🗄️ Cached Intelligence
        {#if tier2Complete}
          <span class="status-badge {tier2Checks.every(c => c.status === 'pass') ? 'pass' : 'warn'}">
            {tier2Checks.every(c => c.status === 'pass') ? '✓ Clear' : '⚠️ Flagged'}
          </span>
        {:else}
          <span class="status-badge loading">⏳ Checking</span>
        {/if}
      </h4>
      <div class="checks-list">
        {#each tier2Checks as check, i (check.label + check.status)}
          <div
            class="check-item {check.status}"
          >
            {#if check.status === 'loading'}
              <span class="check-icon loading">
                <div class="dot-pulse"></div>
              </span>
            {:else}
              <span class="check-icon">
                {#if check.status === 'pass'}✓{:else if check.status === 'warn'}⚠️{:else}✗{/if}
              </span>
            {/if}
            <span class="check-label">{check.label}</span>
            {#if check.detail}
              <span class="check-detail">{check.detail}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Tier 3: Threat Intelligence (API Checks) — URL payloads only -->
  {#if tier2Complete && tier3Checks.length > 0}
    <div class="section">
      <h4 class="section-title">
        🛡️ Threat Intelligence
        {#if tier3Complete}
          <span class="status-badge {tier3Checks.every(c => c.status === 'pass') ? 'pass' : 'warn'}">
            {tier3Checks.every(c => c.status === 'pass') ? '✓ Clear' : '⚠️ Threats Detected'}
          </span>
        {:else}
          <span class="status-badge loading">⏳ Checking</span>
        {/if}
      </h4>
      <div class="checks-list">
        {#each tier3Checks as check, i (check.label + check.status)}
          <div
            class="check-item {check.status}"
          >
            {#if check.status === 'loading'}
              <span class="check-icon loading">
                <div class="dot-pulse"></div>
              </span>
            {:else}
              <span class="check-icon">
                {#if check.status === 'pass'}✓{:else if check.status === 'warn'}⚠️{:else}✗{/if}
              </span>
            {/if}
            <span class="check-label">{check.label}</span>
            {#if check.detail}
              <span class="check-detail">{check.detail}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if finalUrl && verdict !== 'analyzing'}
    <div class="section continue-section">
      <h4 class="section-title">🎯 Final Destination</h4>
      <p class="final-url">{finalUrl}</p>

      {#if verdict === 'safe'}
        <div class="continue-actions">
          <a
            class="continue-btn open safe"
            href={finalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open site ↗
          </a>
          <button class="continue-btn copy" type="button" on:click={copyFinalUrl}>
            {copiedUrl ? '✅ Copied' : '📋 Copy URL'}
          </button>
        </div>
      {:else}
        <p class="continue-warning">
          {#if verdict === 'danger'}
            This link was flagged as high risk. Opening it from here is disabled — copy the
            address only if you need to inspect it elsewhere.
          {:else}
            This link was flagged. Prefer copying the address and verifying it before visiting.
          {/if}
        </p>
        <div class="continue-actions">
          <button class="continue-btn copy primary" type="button" on:click={copyFinalUrl}>
            {copiedUrl ? '✅ Copied' : '📋 Copy URL'}
          </button>
          {#if verdict === 'caution'}
            {#if !confirmOpen}
              <button class="continue-btn open risky" type="button" on:click={() => (confirmOpen = true)}>
                Open anyway…
              </button>
            {:else}
              <a
                class="continue-btn open risky confirm"
                href={finalUrl}
                target="_blank"
                rel="noopener noreferrer"
                on:click={() => (confirmOpen = false)}
              >
                ⚠️ Yes, open the flagged site ↗
              </a>
              <button class="continue-btn cancel" type="button" on:click={() => (confirmOpen = false)}>
                Cancel
              </button>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Analysis Complete Badge -->
  {#if allChecksComplete}
    <div class="complete-badge">
      ✅ Analysis Complete
    </div>
  {/if}
</div>

<style>
  .results-card {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .verdict-banner {
    padding: 20px;
    border-left: 4px solid;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  }

  .verdict-content {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .verdict-emoji {
    font-size: 2.5rem;
    line-height: 1;
  }

  .verdict-text {
    flex: 1;
  }

  .verdict-title {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .verdict-message {
    font-size: 0.95rem;
    opacity: 0.9;
  }

  .spinner {
    width: 24px;
    height: 24px;
  }

  .spinner-circle {
    width: 100%;
    height: 100%;
    border: 3px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .section {
    padding: 20px;
    border-bottom: 1px solid #e0e0e0;
    background: #fff;
  }

  .section:last-child {
    border-bottom: none;
  }

  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 12px 0;
    color: #333;
  }

  .status-badge {
    font-size: 0.85rem;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .status-badge.pass {
    background: #e8f5e9;
    color: #2e7d32;
  }

  .status-badge.warn {
    background: #fff3e0;
    color: #e65100;
  }

  .status-badge.loading {
    background: #e3f2fd;
    color: #1565c0;
  }

  .redirect-section {
    background: #f5f5f5;
  }

  .redirect-tree {
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 0.9rem;
    line-height: 1.6;
  }

  .redirect-hop {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }

  .hop-icon {
    color: #666;
    font-weight: bold;
  }

  .hop-url {
    color: #333;
    word-break: break-all;
  }

  .hop-url.final {
    color: #2e7d32;
    font-weight: 600;
  }

  .hop-badge {
    background: #66bb6a;
    color: white;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .checks-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .check-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border-radius: 8px;
    background: #fafafa;
    transition: all 0.2s ease;
  }

  .check-item.pass {
    background: #f1f8f4;
    border-left: 3px solid #66bb6a;
  }

  .check-item.warn {
    background: #fff8e1;
    border-left: 3px solid #ffa726;
  }

  .check-item.fail {
    background: #ffebee;
    border-left: 3px solid #ef5350;
  }

  .check-item.loading {
    background: #f5f5f5;
    border-left: 3px solid #90caf9;
  }

  .check-icon {
    font-size: 1.1rem;
    font-weight: bold;
    min-width: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .check-icon.loading {
    min-width: 16px;
  }

  .check-label {
    flex: 1;
    font-size: 0.95rem;
    font-weight: 500;
    color: #333;
  }

  .check-detail {
    font-size: 0.85rem;
    color: #666;
    font-style: italic;
  }

  .final-url {
    margin: 6px 0 0 0;
    color: #374151;
    word-break: break-all;
    font-weight: 600;
  }

  .continue-warning {
    margin: 10px 0 0 0;
    font-size: 0.9rem;
    color: #b45309;
  }

  .continue-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 12px;
  }

  .continue-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-radius: 8px;
    border: 1px solid transparent;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: filter 0.15s ease;
  }

  .continue-btn:hover {
    filter: brightness(0.95);
  }

  .continue-btn.open.safe {
    background: #2e7d32;
    color: #fff;
  }

  .continue-btn.copy {
    background: #eceff1;
    color: #263238;
    border-color: #cfd8dc;
  }

  .continue-btn.copy.primary {
    background: #1565c0;
    color: #fff;
    border-color: transparent;
  }

  .continue-btn.open.risky {
    background: transparent;
    color: #b45309;
    border-color: #f59e0b;
  }

  .continue-btn.open.risky.confirm {
    background: #b45309;
    color: #fff;
    border-color: transparent;
  }

  .continue-btn.cancel {
    background: transparent;
    color: #607d8b;
    border-color: #cfd8dc;
  }

  .dot-pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(0.8);
    }
  }

  .complete-badge {
    padding: 16px;
    text-align: center;
    background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
    color: #2e7d32;
    font-weight: 600;
    font-size: 0.95rem;
  }

  /* Mobile responsive */
  @media (max-width: 600px) {
    .verdict-emoji {
      font-size: 2rem;
    }

    .verdict-title {
      font-size: 1.1rem;
    }

    .verdict-message {
      font-size: 0.9rem;
    }

    .section {
      padding: 16px;
    }

    .redirect-hop {
      font-size: 0.85rem;
    }
  }
</style>
