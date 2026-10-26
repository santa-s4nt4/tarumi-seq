import { mkdir, readFile, writeFile } from 'node:fs/promises';
const index = await readFile('dist/index.html', 'utf8');
for (const route of ['console', 'que', 'live']) {
  await mkdir(`dist/${route}`, { recursive: true });
  const html = route === 'live' ? index.replace(/<title>[^<]*<\/title>/, '<title>LIVE GPS | 樽見OTO鉄道</title>')
    .replace(/(<meta name="description" content=")[^"]*/, '$1スマートフォンの現在地と実測速度に合わせて、樽見線の駅・トンネルの合図を表示します。') : index;
  await writeFile(`dist/${route}/index.html`, html);
}
