<script lang="ts">
  import {
    showInstallPrompt,
    promptInstall,
    dismissInstallPrompt
  } from '../lib/install-prompt';

  let installing = false;

  async function handleInstall() {
    installing = true;
    const installed = await promptInstall();
    installing = false;
    if (!installed) {
      dismissInstallPrompt();
    }
  }

  function handleDismiss() {
    dismissInstallPrompt();
  }
</script>

{#if $showInstallPrompt}
  <div class="install-prompt" role="dialog" aria-labelledby="install-title">
    <div class="content">
      <h3 id="install-title">Install QRCheck</h3>
      <p>Add to your home screen for faster access and offline support</p>
    </div>
    <div class="actions">
      <button class="install" on:click={handleInstall} disabled={installing}>
        {installing ? 'Installing...' : 'Install'}
      </button>
      <button class="dismiss" on:click={handleDismiss}>Not now</button>
    </div>
  </div>
{/if}

<style>
  .install-prompt {
    position: fixed;
    bottom: 20px;
    left: 20px;
    right: 20px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    padding: 20px;
    max-width: 400px;
    margin: 0 auto;
    z-index: 1000;
    animation: slideUp 0.3s ease-out;
  }

  @keyframes slideUp {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  h3 {
    margin: 0 0 8px 0;
    font-size: 18px;
    color: #1a1a1a;
  }

  p {
    margin: 0 0 16px 0;
    color: #666;
    font-size: 14px;
    line-height: 1.4;
  }

  .actions {
    display: flex;
    gap: 12px;
  }

  button {
    flex: 1;
    padding: 10px;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s, opacity 0.2s;
  }

  button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .install {
    background: #2e7d32;
    color: white;
  }

  .install:hover:not(:disabled) {
    background: #1b5e20;
  }

  .install:focus-visible {
    outline: 2px solid #2e7d32;
    outline-offset: 2px;
  }

  .dismiss {
    background: #f5f5f5;
    color: #666;
  }

  .dismiss:hover {
    background: #e0e0e0;
  }

  .dismiss:focus-visible {
    outline: 2px solid #666;
    outline-offset: 2px;
  }

  /* Dark mode support */
  :global(.dark) .install-prompt {
    background: #2a2a2a;
  }

  :global(.dark) h3 {
    color: #fff;
  }

  :global(.dark) p {
    color: #aaa;
  }

  :global(.dark) .dismiss {
    background: #3a3a3a;
    color: #ccc;
  }

  :global(.dark) .dismiss:hover {
    background: #4a4a4a;
  }
</style>
