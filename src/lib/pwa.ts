import { writable } from 'svelte/store';

export const needRefresh = writable(false);
export const offlineReady = writable(false);

let updateSWFunc: (() => Promise<void>) | null = null;

export async function registerServiceWorker() {
  if (typeof window === 'undefined') return;

  try {
    const { registerSW } = await import('virtual:pwa-register');

    updateSWFunc = registerSW({
      immediate: true,
      onNeedRefresh() {
        needRefresh.set(true);
      },
      onOfflineReady() {
        offlineReady.set(true);
      },
      onRegistered(r) {
        console.log('Service Worker registered:', r);
      },
      onRegisterError(error) {
        console.error('SW registration error:', error);
      }
    });
  } catch (error) {
    console.error('Failed to register service worker:', error);
  }
}

export async function updateServiceWorker() {
  if (updateSWFunc) {
    await updateSWFunc();
  }
}
