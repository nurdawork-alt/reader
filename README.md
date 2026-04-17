# Читалка

Личная PWA-читалка EPUB для iPhone. Vanilla JS + Vite + epub.js.

## Локально

```bash
npm install
npm run dev
```

## Сборка

```bash
npm run build
npm run preview
```

## Деплой

Пуш в `main` → GitHub Actions собирает и публикует на GitHub Pages.

## Структура

- `src/main.js` — точка входа и роутинг.
- `src/library.js` — библиотека книг (загрузка, удаление).
- `src/reader.js` — чтение, прогресс, оглавление, поиск.
- `src/settings.js` — тема, размер шрифта.
- `src/db.js` — IndexedDB (книги, прогресс, настройки).
- `public/sw.js` — Service Worker, офлайн-кэш оболочки.
- `public/manifest.webmanifest` — PWA-манифест.
- `public/icons/` — иконки для PWA и iOS.

## Установка на iPhone

1. Открой URL приложения в **Safari**.
2. Нажми «Поделиться» → «На экран Домой».
3. Запускай с иконки на рабочем столе.
