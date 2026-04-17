import ePub from 'epubjs';
import { getBook, getProgress, saveProgress } from './db.js';
import { openPanel, closePanel } from './panels.js';

let book = null;
let rendition = null;
let currentBookId = null;
let searchResultsCache = [];

const viewer = document.getElementById('viewer');
const titleEl = document.getElementById('reader-title');
const progressLabel = document.getElementById('progress-label');
const progressFill = document.getElementById('progress-fill');
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

  btnToc.addEventListener('click', () => openPanel(tocPanel));
  btnCloseToc.addEventListener('click', () => closePanel(tocPanel));

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
    if (!document.getElementById('reader-view').classList.contains('active')) return;
    if (e.key === 'ArrowLeft') rendition && rendition.prev();
    if (e.key === 'ArrowRight') rendition && rendition.next();
  });
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

  // Вешаем свайпы/тапы на каждую секцию в iframe (внешний listener на viewer не ловит
  // touch-события из-за iframe boundary — это ключевой фикс свайпов).
  rendition.hooks.content.register((contents) => attachIframeInteractions(contents));

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
    if (progressFill) progressFill.style.width = `${percentage}%`;
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
  if (progressFill) progressFill.style.width = '0%';
  progressLabel.textContent = '0%';
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
        closePanel(tocPanel);
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
      closePanel(tocPanel);
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

// --- Interactions inside iframe (свайпы + тапы по краям) ---
// Вызывается для каждой секции книги при её загрузке.
function attachIframeInteractions(contents) {
  const doc = contents?.document;
  if (!doc) return;

  let startX = 0, startY = 0, startT = 0, tracking = false, moved = false;

  const SWIPE_DIST = 40;      // мин длина свайпа (px)
  const SWIPE_MAX_Y = 70;     // макс вертикальное отклонение
  const SWIPE_MAX_DUR = 700;  // макс время свайпа (ms)
  const TAP_MAX_DUR = 400;    // макс время тапа
  const MOVE_THRESHOLD = 10;  // если сдвинули больше — это уже не тап

  doc.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; startT = Date.now();
    tracking = true; moved = false;
  }, { passive: true });

  doc.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - startX) > MOVE_THRESHOLD || Math.abs(t.clientY - startY) > MOVE_THRESHOLD) {
      moved = true;
    }
  }, { passive: true });

  doc.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startT;

    // Горизонтальный свайп
    if (Math.abs(dx) > SWIPE_DIST && Math.abs(dy) < SWIPE_MAX_Y && dt < SWIPE_MAX_DUR) {
      if (dx < 0) rendition?.next();
      else rendition?.prev();
      return;
    }

    // Тап по краям: левая/правая треть экрана листают страницы
    if (!moved && dt < TAP_MAX_DUR) {
      // Не обрабатываем тапы по ссылкам внутри текста
      const target = e.target;
      if (target && target.closest && target.closest('a')) return;

      const w = doc.documentElement.clientWidth || doc.body.clientWidth;
      if (t.clientX < w * 0.33) rendition?.prev();
      else if (t.clientX > w * 0.67) rendition?.next();
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
