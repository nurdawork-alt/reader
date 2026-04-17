// Регистрация Service Worker только в production.
// В dev-режиме Vite сам раздаёт модули, и SW будет мешать HMR.
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    // base учитывается автоматически через import.meta.env.BASE_URL
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL })
      .catch((err) => console.warn('SW register failed:', err));
  });
}
