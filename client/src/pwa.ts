// Registers the offline service worker (see client/public/sw.js) so the
// offline modes (VS Bot / Hotseat) load without waking the online server.
// Registration is production-only: in dev the Vite server streams modules that
// change constantly, and a cache-first worker would serve stale code.
export function registerOfflineSupport(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Offline support unavailable:', error);
    });
  });
}
