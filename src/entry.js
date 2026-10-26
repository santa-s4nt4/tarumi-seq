const base = import.meta.env.BASE_URL;
const path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
if (/^live(?:\/(?:index\.html)?)?$/.test(path)) {
  document.title = 'LIVE GPS | 樽見OTO鉄道';
  document.querySelector('#loading h2').textContent = '路線データを読み込んでいます';
  document.getElementById('loading-message').textContent = 'LIVE GPS · 現在地で合図を出す';
  await import('./live.js');
} else await import('./main.js');
