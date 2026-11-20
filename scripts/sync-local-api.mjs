import { copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const api = new URL('../../tarumi-api/', import.meta.url);
for (const dir of ['front', 'back']) {
  const file = 'data/gps-' + dir + '.json';
  await copyFile(new URL('../' + file, import.meta.url), new URL(file, api));
}
for (const script of ['db:local', 'data:local']) {
  const run = spawnSync('npm', ['run', script], { cwd: api, stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
