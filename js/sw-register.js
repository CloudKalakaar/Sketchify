/**
 * sw-register.js — Service Worker registration (no ES modules)
 */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast();
        });
      });
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'SW_UPDATED') showUpdateToast();
      });
    } catch (err) { console.warn('SW reg failed:', err); }
  });
}

function showUpdateToast() {
  const toast = document.getElementById('update-toast');
  if (!toast || toast.classList.contains('visible')) return;
  toast.classList.add('visible');
  document.getElementById('update-reload-btn').addEventListener('click', () => window.location.reload(), { once: true });
}
