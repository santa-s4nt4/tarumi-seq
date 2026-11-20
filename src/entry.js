const base = import.meta.env.BASE_URL;
const url = new URL(location.href);
const path = url.pathname.slice(base.length);

// Old QUE bookmarks and shared sections open in the same LIVE view, with
// the original playback parameters and phone invitation fragment intact.
if (/^(?:que|live)(?:\/(?:index\.html)?)?$/.test(path)) {
  if (url.pathname !== base + 'live/') {
    url.pathname = base + 'live/';
    history.replaceState(history.state, '', url);
  }
  if (new URLSearchParams(url.hash.slice(1)).has('gps-send')) {
    await import('./phone-sender.js');
  } else if (url.searchParams.get('mode') === 'playback') {
    await import('./main.js');
  } else {
    document.querySelector('#loading h2').textContent = '全線の時刻表を読み込んでいます';
    await import('./live.js');
  }
} else await import('./main.js');
