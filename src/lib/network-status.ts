import { writable } from 'svelte/store';

export const online = writable(typeof navigator !== 'undefined' ? navigator.onLine : true);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => online.set(true));
  window.addEventListener('offline', () => online.set(false));
}
