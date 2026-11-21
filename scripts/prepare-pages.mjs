import { mkdir, readFile, writeFile } from 'node:fs/promises';
const index = (await readFile('dist/index.html', 'utf8'))
  .replace(/<title>[^<]*<\/title>/, '<title>樽見OTO鉄道</title>')
  .replace(/(<meta name="description" content=")[^"]*/, '$1樽見鉄道の列車をLIVEで追いかけたり、CUSTOMで駅とダイヤを選んで再生できます。');
await writeFile('dist/index.html', index);
for (const route of ['que', 'live', 'custom']) {
  await mkdir(`dist/${route}`, { recursive: true });
  await writeFile(`dist/${route}/index.html`, index);
}
// Do not publish Console or PERFORMANCE; old Console bookmarks return home.
await mkdir('dist/console', { recursive: true });
await writeFile('dist/console/index.html', `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=../"><title>樽見OTO鉄道</title>
<script>location.replace('../')</script>
</head><body><a href="../">トップを開く</a></body></html>`);
