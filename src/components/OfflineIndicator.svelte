<script lang="ts">
  import { online } from '../lib/network-status';
</script>

{#if !$online}
  <div class="offline-banner" role="status" aria-live="polite">
    <span class="offline-icon" aria-hidden="true">&#x1F4F4;</span>
    <span>Offline Mode - Basic checks only</span>
  </div>
{/if}

<style>
  .offline-banner {
    background: #ff9800;
    color: white;
    padding: 8px 16px;
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .offline-icon {
    font-size: 16px;
  }
</style>
