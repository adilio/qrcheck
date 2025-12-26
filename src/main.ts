import './app.css';
import App from './App.svelte';
import { registerServiceWorker } from './lib/pwa';
import { initInstallPrompt } from './lib/install-prompt';

// Initialize PWA features
registerServiceWorker();
initInstallPrompt();

const app = new App({
  target: document.getElementById('app') as HTMLElement
});

export default app;
