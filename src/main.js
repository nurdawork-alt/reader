import { initLibrary, render as renderLibrary } from './library.js';
import { initReader, openBook, closeBook } from './reader.js';
import { initSettings } from './settings.js';
import { registerSW } from './registerSW.js';
import { closeAllPanels } from './panels.js';

const libraryView = document.getElementById('library-view');
const readerView = document.getElementById('reader-view');
const btnBack = document.getElementById('btn-back');
const readerLoading = document.getElementById('reader-loading');

// Длительность view-транзишна из CSS (var(--dur) = 280ms)
const VIEW_DUR = 280;

function showLibrary() {
  closeAllPanels();
  readerView.classList.remove('active');
  libraryView.classList.add('active');
  // Ждём конца анимации перед освобождением ресурсов книги
  setTimeout(() => {
    closeBook();
    renderLibrary();
  }, VIEW_DUR);
}

async function showReader(bookId) {
  closeAllPanels();
  readerLoading.classList.add('visible');
  libraryView.classList.remove('active');
  readerView.classList.add('active');
  try {
    await openBook(bookId);
  } catch (err) {
    console.error(err);
    alert('Не удалось открыть книгу: ' + (err?.message || err));
    showLibrary();
    return;
  } finally {
    readerLoading.classList.remove('visible');
  }
}

btnBack.addEventListener('click', showLibrary);

// init
(async () => {
  initReader();
  await initSettings();
  await initLibrary({ onOpen: showReader });
  registerSW();
})().catch((err) => {
  console.error('Init failed:', err);
  alert('Ошибка инициализации: ' + (err?.message || err));
});
