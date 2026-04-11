/**
 * Registers the EduIntellect service worker.
 * Dispatches custom events:
 *   'sw-update-available' — a new SW version is waiting
 *   'sw-registered'       — SW registered successfully
 *
 * Registered in ALL environments (prod + dev) so offline works during testing too.
 */
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      window.dispatchEvent(new CustomEvent('sw-registered', { detail: reg }));

      // Check for waiting worker (update available on page load)
      if (reg.waiting) {
        window.dispatchEvent(new CustomEvent('sw-update-available', { detail: reg }));
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('sw-update-available', { detail: reg }));
          }
        });
      });
    } catch (err) {
      console.error('[SW] Registration failed:', err);
    }
  });
}

/** Tell the waiting SW to take over immediately, then reload */
export function applyUpdate(reg: ServiceWorkerRegistration) {
  if (reg.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
  }
}
