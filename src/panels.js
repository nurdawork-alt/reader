// Управление панелями (bottom sheets) и общим backdrop.
// Один backdrop на все панели; при открытии любой панели он появляется,
// при закрытии последней — исчезает. Клик по backdrop закрывает все.

const backdrop = document.getElementById('backdrop');
const openPanels = new Set();

export function openPanel(panel) {
  panel.classList.add('open');
  openPanels.add(panel);
  backdrop.classList.add('visible');
}

export function closePanel(panel) {
  panel.classList.remove('open');
  openPanels.delete(panel);
  if (openPanels.size === 0) {
    backdrop.classList.remove('visible');
  }
}

export function closeAllPanels() {
  for (const p of openPanels) p.classList.remove('open');
  openPanels.clear();
  backdrop.classList.remove('visible');
}

export function isPanelOpen(panel) {
  return openPanels.has(panel);
}

// Backdrop закрывает всё при клике
backdrop.addEventListener('click', closeAllPanels);

// Escape закрывает верхнюю панель (для десктопа / клавиатур)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openPanels.size > 0) {
    closeAllPanels();
  }
});
