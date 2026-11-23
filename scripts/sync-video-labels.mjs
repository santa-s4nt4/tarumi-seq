// Copies the cue labels and route made in ../video-labeler into public/data
// for VIDEO. Run after labelling: npm run video:sync
import fs from 'node:fs';

const labeler = new URL('../../video-labeler/', import.meta.url), data = new URL('../public/data/', import.meta.url);
const files = [['data/labels.json', 'video-labels-back.json'], ['data/labels-front.json', 'video-labels-front.json'], ['public/route.json', 'video-route.json']];
for (const [from, to] of files) {
  const text = fs.readFileSync(new URL(from, labeler), 'utf8');
  const doc = JSON.parse(text);
  fs.writeFileSync(new URL(to, data), text);
  if (!doc.features) { console.log(`${to}: 路線`); continue; }
  const keys = doc.features.flatMap(feature => ['in', 'out'].filter(edge => Number.isFinite(feature[edge])).map(edge => feature[`${edge}Ok`]));
  console.log(`${to}: ${doc.features.length} 件、時刻 ${keys.length} キー（確認済み ${keys.filter(Boolean).length}）`);
}
