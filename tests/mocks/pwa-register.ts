// Mock for virtual:pwa-register
export function registerSW(options: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: Error) => void;
}) {
  // Store callbacks for testing
  if (options.onRegistered) {
    options.onRegistered(undefined);
  }

  // Return update function
  return async () => {
    // Mock update function
  };
}
