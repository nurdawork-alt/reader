import { loadSettings, saveSettings } from './db.js';
import { setTheme, setFontScale } from './reader.js';
import { openPanel, closePanel } from './panels.js';

const DEFAULTS = {
  theme: 'light',
  fontScale: 100,
};

const state = { ...DEFAULTS };

const panel = document.getElementById('settings-panel');
const btnOpen = document.getElementById('btn-settings');
const btnClose = document.getElementById('btn-close-settings');
const themeSwitch = document.getElementById('theme-switch');
const fontRange = document.getElementById('font-size');
const fontValue = document.getElementById('font-size-value');
const btnForceUpdate = document.getElementById('btn-force-update');

export async function initSettings() {
  const saved = await loadSettings();
  if (saved) Object.assign(state, saved);

  btnOpen.addEventListener('click', () => openPanel(panel));
  btnClose.addEventListener('click', () => closePanel(panel));

  if (btnForceUpdate) {
    btnForceUpdate.addEventListener('click', forceUpdate);
  }

  themeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-theme]');
    if (!btn) return;
    state.theme = btn.dataset.theme;
    applyAndPersist();
  });

  fontRange.addEventListener('input', () => {
    state.fontScale = Number(fontRange.value);
    applyAndPersist();
  });

  applyToUI();
  applyToReader();
  applyDocumentTheme();
}

function applyToUI() {
  fontRange.value = String(state.fontScale);
  fontValue.textContent = `${state.fontScale}%`;
  themeSwitch.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === state.theme);
  });
}

function applyToReader() {
  setTheme(state.theme);
  setFontScale(state.fontScale);
}

function applyDocumentTheme() {
  document.documentElement.dataset.theme = state.theme;
}

function applyAndPersist() {
  applyToUI();
  applyToReader();
  applyDocumentTheme();
  saveSettings(state).catch(console.error);
}

export function getSettings() {
  return { ...state };
}

// Принудительное обновление: сносит все кэши и SW, перезагружает.
// IndexedDB (книги + прогресс) НЕ трогаем — остаются на месте.
async function forceUpdate() {
  btnForceUpdate.disabled = true;
  btnForceUpdate.textContent = 'Обновляю…';
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (err) {
    console.error('force update failed:', err);
  }
  // Hard reload с обходом HTTP-кэша (без кэша query param)
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now().toString(36));
  window.location.replace(url.toString());
}
