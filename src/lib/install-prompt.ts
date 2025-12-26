import { writable, get } from 'svelte/store';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export const deferredPrompt = writable<BeforeInstallPromptEvent | null>(null);
export const showInstallPrompt = writable(false);
export const isInstalled = writable(false);

export function initInstallPrompt() {
  if (typeof window === 'undefined') return;

  // Check if already installed
  if (window.matchMedia('(display-mode: standalone)').matches) {
    isInstalled.set(true);
    return;
  }

  // Check if dismissed recently (within 7 days)
  const dismissedAt = localStorage.getItem('installPromptDismissed');
  if (dismissedAt) {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - parseInt(dismissedAt) < sevenDays) {
      return;
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt.set(e as BeforeInstallPromptEvent);

    // Show after first scan (check localStorage)
    const scanCount = parseInt(localStorage.getItem('scanCount') || '0');
    if (scanCount >= 1) {
      showInstallPrompt.set(true);
    }
  });

  window.addEventListener('appinstalled', () => {
    isInstalled.set(true);
    deferredPrompt.set(null);
    showInstallPrompt.set(false);
  });
}

export async function promptInstall(): Promise<boolean> {
  const prompt = get(deferredPrompt);

  if (!prompt) return false;

  await prompt.prompt();
  const result = await prompt.userChoice;

  if (result.outcome === 'accepted') {
    deferredPrompt.set(null);
    showInstallPrompt.set(false);
    return true;
  }

  return false;
}

export function dismissInstallPrompt() {
  showInstallPrompt.set(false);
  localStorage.setItem('installPromptDismissed', Date.now().toString());
}

export function triggerInstallPromptAfterScan() {
  const prompt = get(deferredPrompt);
  if (prompt && !get(isInstalled)) {
    showInstallPrompt.set(true);
  }
}
