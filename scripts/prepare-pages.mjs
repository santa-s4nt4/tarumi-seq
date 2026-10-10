import { mkdir, copyFile } from 'node:fs/promises';
for (const route of ['console', 'que']) {
  await mkdir(`dist/${route}`, { recursive: true });
  await copyFile('dist/index.html', `dist/${route}/index.html`);
}
