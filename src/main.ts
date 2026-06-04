import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { registerServiceWorker } from './lib/pwa';
import { initInstallPrompt } from './lib/install-prompt';

registerServiceWorker();
initInstallPrompt();

const app = mount(App, {
  target: document.getElementById('app') as HTMLElement
});

export default app;
