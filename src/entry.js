const base = import.meta.env.BASE_URL;
const url = new URL(location.href);
const path = url.pathname.slice(base.length).replace(/\/?index\.html$/, '').replace(/\/$/, '');
if (import.meta.env.DEV && path === 'console') {
  document.body.innerHTML = (await import('./console.html?raw')).default;
  await import('./main.js');
} else if (import.meta.env.DEV && new URLSearchParams(url.hash.slice(1)).has('gps-send')) {
  await import('./phone-sender.js');
} else {
  if (path === 'que' || (path === 'live' && url.searchParams.get('mode') === 'playback')) {
    url.pathname = base + 'custom/'; url.searchParams.delete('mode');
    history.replaceState(null, '', url);
  } else if (!['', 'live', 'custom', 'video'].includes(path) && !(import.meta.env.DEV && path === 'performance')) {
    history.replaceState(null, '', base);
  }
  await import('./experience.js');
}
