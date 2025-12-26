<script lang="ts">
  import { needRefresh, updateServiceWorker } from '../lib/pwa';

  async function handleUpdate() {
    await updateServiceWorker();
  }
</script>

{#if $needRefresh}
  <div class="update-prompt" role="alert">
    <span>New version available!</span>
    <button on:click={handleUpdate}>Update</button>
  </div>
{/if}

<style>
  .update-prompt {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #2e7d32;
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    display: flex;
    gap: 12px;
    align-items: center;
    z-index: 1000;
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  button {
    background: white;
    color: #2e7d32;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.2s;
  }

  button:hover {
    background: #e8f5e9;
  }

  button:focus-visible {
    outline: 2px solid white;
    outline-offset: 2px;
  }
</style>
