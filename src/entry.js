const base = import.meta.env.BASE_URL;
const path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
const isQue = /^que(?:\/(?:index\.html)?)?$/.test(path);
const playback = new URLSearchParams(location.search).get('mode') === 'playback';
if (/^live(?:\/(?:index\.html)?)?$/.test(path) && new URLSearchParams(location.hash.slice(1)).has('gps-send')) {
  await import('./phone-sender.js');
} else if (/^live(?:\/(?:index\.html)?)?$/.test(path) || (isQue && !playback)) {
  document.querySelector('#loading h2').textContent = '全線の時刻表を読み込んでいます';
  await import('./live.js');
} else await import('./main.js');
