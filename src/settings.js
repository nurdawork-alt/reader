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

export async function initSettings() {
  const saved = await loadSettings();
  if (saved) Object.assign(state, saved);

  btnOpen.addEventListener('click', () => openPanel(panel));
  btnClose.addEventListener('click', () => closePanel(panel));

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
