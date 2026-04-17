// Регистрация Service Worker только в production.
// В dev-режиме Vite сам раздаёт модули, и SW будет мешать HMR.
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  window.addEventListener('load', async () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    try {
      const reg = await navigator.serviceWorker.register(swUrl, {
        scope: import.meta.env.BASE_URL,
      });

      // Если найдено обновление — подскажем SW сразу активироваться
      // и перезагрузим страницу, чтобы юзер получил свежий код.
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage('SKIP_WAITING');
          }
        });
      });

      // Когда новый SW стал контроллером — перезагружаем один раз.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });

      // Периодически проверяем обновление (каждые 60 секунд при открытой PWA).
      setInterval(() => reg.update().catch(() => {}), 60_000);
    } catch (err) {
      console.warn('SW register failed:', err);
    }
  });
}
