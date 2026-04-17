import ePub from 'epubjs';
import { addBook, deleteBook, listBooks } from './db.js';

const grid = document.getElementById('library-grid');
const emptyState = document.getElementById('empty-state');
const fileInput = document.getElementById('file-input');

// Колбэк «открыть книгу» — проставляется снаружи (main.js).
let onOpenBook = null;

export function initLibrary({ onOpen }) {
  onOpenBook = onOpen;
  fileInput.addEventListener('change', handleFileSelected);
  return render();
}

export async function render() {
  const books = await listBooks();
  grid.innerHTML = '';

  if (books.length === 0) {
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    for (const book of books) {
      grid.appendChild(renderCard(book));
    }
  }
}

function renderCard(book) {
  const card = document.createElement('button');
  card.className = 'book-card';
  card.type = 'button';
  card.addEventListener('click', () => onOpenBook && onOpenBook(book.id));

  const coverWrap = document.createElement('div');
  coverWrap.className = 'cover';
  if (book.cover) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(book.cover);
    img.alt = '';
    img.onload = () => URL.revokeObjectURL(img.src);
    coverWrap.appendChild(img);
  } else {
    coverWrap.classList.add('cover-placeholder');
    coverWrap.textContent = (book.title || '?').slice(0, 1).toUpperCase();
  }

  const title = document.createElement('div');
  title.className = 'book-title';
  title.textContent = book.title || 'Без названия';

  const author = document.createElement('div');
  author.className = 'book-author';
  author.textContent = book.author || '';

  const del = document.createElement('button');
  del.className = 'book-delete';
  del.type = 'button';
  del.textContent = '✕';
  del.setAttribute('aria-label', 'Удалить');
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm(`Удалить «${book.title || 'книгу'}»?`)) {
      await deleteBook(book.id);
      render();
    }
  });

  card.append(coverWrap, title, author, del);
  return card;
}

async function handleFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // чтобы можно было повторно выбрать тот же файл
  if (!file) return;

  try {
    await importEpubFile(file);
    await render();
  } catch (err) {
    console.error(err);
    alert('Не удалось добавить книгу: ' + (err?.message || err));
  }
}

async function importEpubFile(file) {
  const buf = await file.arrayBuffer();
  // epub.js принимает ArrayBuffer напрямую.
  const book = ePub(buf);
  await book.ready;

  const meta = book.package?.metadata || {};
  const title = meta.title || file.name.replace(/\.epub$/i, '');
  const author = meta.creator || '';

  let coverBlob = null;
  try {
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const resp = await fetch(coverUrl);
      if (resp.ok) coverBlob = await resp.blob();
    }
  } catch {
    // обложки может не быть — это ок
  }

  const id = crypto.randomUUID();
  const fileBlob = new Blob([buf], { type: 'application/epub+zip' });

  await addBook({
    id,
    title,
    author,
    cover: coverBlob,
    file: fileBlob,
    addedAt: Date.now(),
  });

  // освобождаем ресурсы epub.js
  book.destroy();
}
