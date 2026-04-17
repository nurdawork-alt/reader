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
const viewerOverlay = document.getElementById('viewer-overlay');
const viewerEl = document.getElementById('viewer');

// Флаг блокировки повторных вызовов во время анимации перелистывания
let turnPending = false;
const TURN_DURATION = 180; // должно совпадать с transition в .viewer iframe

// Темы для epub.js — применяются к итератору текста внутри iframe.
const READER_THEMES = {
  light: { body: { background: '#ffffff', color: '#111111' } },
  sepia: { body: { background: '#f4ecd8', color: '#3a2f22' } },
  dark:  { body: { background: '#111111', color: '#e6e6e6' } },
};

export function initReader() {
  btnPrev.addEventListener('click', () => turnPage('prev'));
  btnNext.addEventListener('click', () => turnPage('next'));

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
    if (e.key === 'ArrowLeft') turnPage('prev');
    if (e.key === 'ArrowRight') turnPage('next');
  });

  // Свайпы и тапы через прозрачный overlay поверх iframe.
  // Это самый надёжный способ на iOS: iframe touch events не всплывают,
  // хуки epub.js не всегда срабатывают, а overlay ловит всё гарантированно.
  attachOverlayInteractions(viewerOverlay);
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

// --- Interactions через прозрачный overlay поверх iframe ---
// Вешается ОДИН РАЗ в initReader, работает для всех книг.
function attachOverlayInteractions(el) {
  if (!el) return;

  let startX = 0, startY = 0, startT = 0, tracking = false, moved = false;

  const SWIPE_DIST = 40;      // мин длина свайпа (px)
  const SWIPE_MAX_Y = 80;     // макс вертикальное отклонение
  const SWIPE_MAX_DUR = 800;  // макс время свайпа (ms)
  const TAP_MAX_DUR = 400;    // макс время тапа
  const MOVE_THRESHOLD = 10;  // порог определения движения

  const handleStart = (x, y) => {
    startX = x; startY = y; startT = Date.now();
    tracking = true; moved = false;
  };

  const handleMove = (x, y) => {
    if (!tracking) return;
    if (Math.abs(x - startX) > MOVE_THRESHOLD || Math.abs(y - startY) > MOVE_THRESHOLD) {
      moved = true;
    }
  };

  const handleEnd = (x, y) => {
    if (!tracking) return;
    tracking = false;
    const dx = x - startX;
    const dy = y - startY;
    const dt = Date.now() - startT;

    // Горизонтальный свайп
    if (Math.abs(dx) > SWIPE_DIST && Math.abs(dy) < SWIPE_MAX_Y && dt < SWIPE_MAX_DUR) {
      turnPage(dx < 0 ? 'next' : 'prev');
      return;
    }

    // Тап по левой/правой трети — листать
    if (!moved && dt < TAP_MAX_DUR) {
      const w = el.clientWidth;
      if (x < w * 0.33) turnPage('prev');
      else if (x > w * 0.67) turnPage('next');
      // Центральная треть — ничего (в будущем можно тоггл UI)
    }
  };

  // Touch events
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    const t = e.touches[0];
    handleStart(t.clientX, t.clientY);
  }, { passive: false });

  el.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    handleMove(t.clientX, t.clientY);
  }, { passive: false });

  el.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    handleEnd(t.clientX, t.clientY);
  }, { passive: false });

  el.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });

  // Mouse fallback (для десктопа)
  el.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
  el.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
  el.addEventListener('mouseup', (e) => handleEnd(e.clientX, e.clientY));
  el.addEventListener('mouseleave', () => { tracking = false; });
}

// Анимированное перелистывание.
// Последовательность: добавляем класс (iframe fade+slide out) →
// ждём конца transition → переключаем страницу → снимаем класс (fade+slide in).
async function turnPage(direction) {
  if (!rendition || turnPending) return;
  turnPending = true;

  const cls = direction === 'next' ? 'turn-next' : 'turn-prev';
  viewerEl.classList.add(cls);

  // Даём браузеру один кадр на старт transition и ~TURN_DURATION на её проигрыш.
  await delay(TURN_DURATION);

  try {
    if (direction === 'next') await rendition.next();
    else await rendition.prev();
  } catch (err) {
    console.warn('turn page failed', err);
  }

  // Ждём отрисовки новой страницы, затем плавно возвращаем на место.
  requestAnimationFrame(() => {
    viewerEl.classList.remove(cls);
    // Разрешаем следующий ход после завершения fade-in.
    setTimeout(() => { turnPending = false; }, TURN_DURATION);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
