// Генерация простых плейсхолдер-иконок для PWA.
// Использует только встроенные модули Node (zlib) — без внешних зависимостей.
// Рисует тёмный квадрат со светлой буквой «Ч» в центре (растровый контур).
// Потом замени на нормальные иконки: просто положи PNG в public/icons/ с теми же именами.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const BG = [17, 17, 17];     // #111111
const FG = [230, 230, 230];  // #e6e6e6

// --- PNG helpers ---

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function makePNG(width, height, pixelFn) {
  // RGB, filter type 0, one byte per row prefix.
  const rowLength = 1 + width * 3;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowLength;
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      const i = rowStart + 1 + x * 3;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Простая «буква Ч» нарисованная линиями-прямоугольниками в нормализованных координатах [0..1] ---
// Форма: вертикаль справа, верхняя часть буквы (левая палочка + перекладина).
// Ч = вертикальная палочка + короткая палочка сверху-слева + перекладина посередине.

function drawCharChe(ctx, cx, cy, size, color, safe = false) {
  const stroke = Math.round(size * 0.11);
  const half = Math.round(size / 2);
  const topY = cy - half;
  const midY = cy;
  const leftX = cx - half;
  const rightX = cx + half;

  // правая вертикаль (во всю высоту)
  ctx.rect(rightX - stroke, topY, stroke, size, color);
  // левая вертикаль только в верхней половине
  ctx.rect(leftX, topY, stroke, Math.round(size * 0.55), color);
  // перекладина — горизонталь между левой и правой палочками
  ctx.rect(leftX, midY - Math.round(stroke / 2), size, stroke, color);
}

function makeIcon(size, { maskableSafePadding = 0 } = {}) {
  // Нарисуем фон и букву в буфер 2D.
  const pixels = new Uint8Array(size * size * 3);
  // Заливка фона
  for (let i = 0; i < size * size; i++) {
    pixels[i * 3] = BG[0]; pixels[i * 3 + 1] = BG[1]; pixels[i * 3 + 2] = BG[2];
  }

  const ctx = {
    rect(x, y, w, h, color) {
      const x0 = Math.max(0, Math.floor(x));
      const y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(size, Math.floor(x + w));
      const y1 = Math.min(size, Math.floor(y + h));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const idx = (yy * size + xx) * 3;
          pixels[idx] = color[0];
          pixels[idx + 1] = color[1];
          pixels[idx + 2] = color[2];
        }
      }
    }
  };

  // Для maskable оставим безопасную зону: буква меньше, чтобы влезла в круг.
  const effective = maskableSafePadding ? size * (1 - maskableSafePadding * 2) : size * 0.62;
  const letterSize = Math.round(effective);
  drawCharChe(ctx, Math.floor(size / 2), Math.floor(size / 2), letterSize, FG);

  return makePNG(size, size, (x, y) => {
    const i = (y * size + x) * 3;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  });
}

// --- Генерация всех нужных файлов ---

const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-512.png', size: 512, maskableSafePadding: 0.1 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const t of targets) {
  const buf = makeIcon(t.size, { maskableSafePadding: t.maskableSafePadding || 0 });
  const out = path.join(outDir, t.name);
  fs.writeFileSync(out, buf);
  console.log(`✔ ${t.name}  (${t.size}×${t.size}, ${(buf.length / 1024).toFixed(1)} KB)`);
}

console.log('\nИконки сгенерированы в public/icons/. Замени на кастомные в любой момент.');
