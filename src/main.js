import { initLibrary, render as renderLibrary } from './library.js';
import { initReader, openBook, closeBook } from './reader.js';
import { initSettings } from './settings.js';
import { registerSW } from './registerSW.js';

const libraryView = document.getElementById('library-view');
const readerView = document.getElementById('reader-view');
const btnBack = document.getElementById('btn-back');

function showLibrary() {
  readerView.hidden = true;
  libraryView.hidden = false;
  closeBook();
  renderLibrary();
}

async function showReader(bookId) {
  libraryView.hidden = true;
  readerView.hidden = false;
  try {
    await openBook(bookId);
  } catch (err) {
    console.error(err);
    alert('Не удалось открыть книгу: ' + (err?.message || err));
    showLibrary();
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
