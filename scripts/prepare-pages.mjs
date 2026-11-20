import { mkdir, readFile, writeFile } from 'node:fs/promises';
const index = await readFile('dist/index.html', 'utf8');
for (const route of ['console', 'que', 'live']) {
  await mkdir(`dist/${route}`, { recursive: true });
  const html = route !== 'console' ? index.replace(/<title>[^<]*<\/title>/, '<title>LIVE · 列車位置と合図 | 樽見OTO鉄道</title>')
    .replace(/(<meta name="description" content=")[^"]*/, '$1樽見線の全線図で時刻表上の列車位置を確認し、選んだ列車の駅・トンネルの合図を表示します。') : index;
  await writeFile(`dist/${route}/index.html`, html);
}
