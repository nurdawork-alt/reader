import { defineConfig } from 'vite';

// GitHub Pages раздаёт сайт по пути /<repo-name>/, поэтому base должен совпадать.
// Имя репозитория будет установлено ниже при gh repo create.
// Если репо переименуешь — поменяй здесь.
const REPO_NAME = 'reader';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  server: {
    host: true, // чтобы проверять с iPhone по локальной сети при необходимости
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
}));
