import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// GitHub Pages раздаёт сайт по пути /<repo-name>/, поэтому base должен совпадать.
// Имя репозитория будет установлено ниже при gh repo create.
// Если репо переименуешь — поменяй здесь.
const REPO_NAME = 'reader';

// Автоматически инвалидируем Service Worker кэш при каждом билде,
// подставляя build-id в public/sw.js при копировании.
function bumpSWCacheVersion() {
  return {
    name: 'bump-sw-cache-version',
    closeBundle() {
      const swPath = path.resolve('dist/sw.js');
      if (!fs.existsSync(swPath)) return;
      const buildId = Date.now().toString(36);
      let content = fs.readFileSync(swPath, 'utf8');
      content = content.replace(
        /const CACHE_VERSION = ['"][^'"]+['"]/,
        `const CACHE_VERSION = '${buildId}'`
      );
      fs.writeFileSync(swPath, content);
      console.log(`  ↳ SW cache version bumped to '${buildId}'`);
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  plugins: [bumpSWCacheVersion()],
}));
