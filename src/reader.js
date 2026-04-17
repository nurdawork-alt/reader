import ePub from 'epubjs';
import { getBook, getProgress, saveProgress } from './db.js';

let book = null;
let rendition = null;
let currentBookId = null;
let searchResultsCache = [];

const viewer = document.getElementById('viewer');
const titleEl = document.getElementById('reader-title');
const progressLabel = document.getElementById('progress-label');
const tocPanel = document.getElementById('toc-panel');
const tocList = document.getElementById('toc-list');
const searchTab = document.getElementById('search-tab');
const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');

const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnToc = document.getElementById('btn-toc');
const btnCloseToc = document.getElementById('btn-close-toc');

// Темы для epub.js — применяются к итератору текста внутри iframe.
const READER_THEMES = {
  light: { body: { background: '#ffffff', color: '#111111' } },
  sepia: { body: { background: '#f4ecd8', color: '#3a2f22' } },
  dark:  { body: { background: '#111111', color: '#e6e6e6' } },
};

export function initReader() {
  btnPrev.addEventListener('click', () => rendition && rendition.prev());
  btnNext.addEventListener('click', () => rendition && rendition.next());

  btnToc.addEventListener('click', () => { tocPanel.hidden = false; });
  btnCloseToc.addEventListener('click', () => { tocPanel.hidden = true; });

  // Вкладки «Содержание / Поиск»
  tocPanel.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      tocPanel.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      const tab = btn.dataset.tab;
      tocList.hidden = tab !== 'toc';
      searchTab.hidden = tab !== 'search';
      if (tab === 'search') searchInput.focus();
    });
  });

  searchInput.addEventListener('input', debounce(runSearch, 250));

  // Клавиши стрелок на десктопе — удобно при тестировании.
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('reader-view').hidden) return;
    if (e.key === 'ArrowLeft') rendition && rendition.prev();
    if (e.key === 'ArrowRight') rendition && rendition.next();
  });

  // Свайпы по области просмотра
  attachSwipeNav(viewer);
}

export async function openBook(bookId) {
  await closeBook();

  const record = await getBook(bookId);
  if (!record) throw new Error('Книга не найдена');

  currentBookId = bookId;
  titleEl.textContent = record.title || 'Без названия';

  const buf = await record.file.arrayBuffer();
  book = ePub(buf);
  rendition = book.renderTo(viewer, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    manager: 'default',
    spread: 'none',
    allowScriptedContent: false,
  });

  // Регистрируем темы.
  for (const [name, rules] of Object.entries(READER_THEMES)) {
    rendition.themes.register(name, rules);
  }

  await book.ready;

  // Восстановим прогресс или начнём с начала.
  const progress = await getProgress(bookId);
  if (progress?.cfi) {
    await rendition.display(progress.cfi);
  } else {
    await rendition.display();
  }

  // Применить текущую тему/шрифт из настроек, если main.js их уже выставил.
  applyCurrentSettings();

  // Сохранение прогресса при каждом перелистывании.
  rendition.on('relocated', (location) => {
    const cfi = location?.start?.cfi;
    const percentage = Math.round((location?.start?.percentage || 0) * 100);
    if (cfi) saveProgress(bookId, cfi, percentage).catch(console.error);
    progressLabel.textContent = `${percentage}%`;
  });

  // Рендер оглавления.
  renderTOC(book.navigation?.toc || []);

  // Отрезолвим размеры после того как DOM нарисовался.
  requestAnimationFrame(() => rendition.resize());
}

export async function closeBook() {
  if (rendition) {
    try { rendition.destroy(); } catch {}
    rendition = null;
  }
  if (book) {
    try { book.destroy(); } catch {}
    book = null;
  }
  currentBookId = null;
  tocList.innerHTML = '';
  searchResultsEl.innerHTML = '';
  searchInput.value = '';
  searchResultsCache = [];
}

// --- Настройки, применяемые к активному чтению ---

let currentTheme = 'light';
let currentFontScale = 100;

export function setTheme(theme) {
  currentTheme = theme;
  if (rendition) rendition.themes.select(theme);
}

export function setFontScale(pct) {
  currentFontScale = pct;
  if (rendition) rendition.themes.fontSize(`${pct}%`);
}

function applyCurrentSettings() {
  if (!rendition) return;
  rendition.themes.select(currentTheme);
  rendition.themes.fontSize(`${currentFontScale}%`);
}

// --- TOC ---

function renderTOC(toc) {
  tocList.innerHTML = '';
  const build = (items, depth = 0) => {
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'toc-row';
      row.style.paddingLeft = `${12 + depth * 14}px`;
      row.textContent = item.label.trim();
      row.addEventListener('click', () => {
        rendition.display(item.href);
        tocPanel.hidden = true;
      });
      tocList.appendChild(row);
      if (item.subitems && item.subitems.length) build(item.subitems, depth + 1);
    }
  };
  build(toc);
}

// --- Поиск ---

async function runSearch() {
  const q = searchInput.value.trim();
  searchResultsEl.innerHTML = '';
  searchResultsCache = [];
  if (q.length < 2 || !book) return;

  // Поиск идёт по всем секциям (spine). На больших книгах медленно — это ок для v1.
  const results = [];
  const sections = book.spine.spineItems;
  for (const section of sections) {
    try {
      await section.load(book.load.bind(book));
      const found = section.find(q);
      if (found && found.length) results.push(...found);
      section.unload();
      if (results.length > 200) break; // защита от перегруза
    } catch (err) {
      console.warn('search section failed', err);
    }
  }

  searchResultsCache = results;
  for (const r of results) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'search-row';
    row.innerHTML = highlightExcerpt(r.excerpt, q);
    row.addEventListener('click', () => {
      rendition.display(r.cfi);
      tocPanel.hidden = true;
    });
    searchResultsEl.appendChild(row);
  }

  if (results.length === 0) {
    searchResultsEl.innerHTML = '<div class="muted search-empty">Ничего не найдено</div>';
  }
}

function highlightExcerpt(text, query) {
  const safe = escapeHTML(text);
  const re = new RegExp(`(${escapeRegex(query)})`, 'ig');
  return safe.replace(re, '<mark>$1</mark>');
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Swipe ---

function attachSwipeNav(el) {
  let startX = 0, startY = 0, startT = 0, tracking = false;

  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; startT = Date.now();
    tracking = true;
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startT;
    if (Math.abs(dx) > 40 && Math.abs(dy) < 60 && dt < 600) {
      if (dx < 0) rendition?.next(); else rendition?.prev();
    }
  }, { passive: true });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
