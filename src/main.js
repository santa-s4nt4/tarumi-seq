import * as mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createIcons, TrainFront, Settings2, Scan, LocateFixed, Plus, Minus, Navigation, Waves, Mountain, Info, AudioLines, SkipBack, SkipForward, RotateCcw, RotateCw, Play, Pause, Gauge, X } from 'lucide';
import './style.css';
import { clamp, sampleAt, recordedAt, timeLabel, advanceTime, stationEvent } from './timeline.js';
import { PositionApi, DEFAULT_ENDPOINT, PUBLIC_ENDPOINT, validateEndpoint } from './api.js';
import { buildRoute, interpolatePrediction } from './interpolate.js';
import { xy } from './geometry.js';


const $ = id => document.getElementById(id);
const icons = { TrainFront, Settings2, Scan, LocateFixed, Plus, Minus, Navigation, Waves, Mountain, Info, AudioLines, SkipBack, SkipForward, RotateCcw, RotateCw, Play, Pause, Gauge, X };
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.7 } });
refreshIcons();
const state = { direction: 'front', time: 0, playing: false, rate: 1, follow: false, response: null, responseT: null, ready: false };
let recordings, mapData, routes, rivers, stations, map, mapReady = false, marker, stationMarkers = [], seekTimer, lastApiSecond = -1, lastFrame = performance.now(), lastDraw = -Infinity;
const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString('ja-JP') : '—';
const rec = () => recordings[state.direction];
const data = () => mapData[state.direction];
const range = () => [rec().records[0].t, rec().records.at(-1).t];
const point = () => sampleAt(rec().records, state.time);
const prediction = () => state.ready && !point().gap ? interpolatePrediction(state.response, state.responseT, state.time, routes[state.direction], rivers[state.direction], state.response?.datasetVersion === data().version) : null;
const clock = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function storedEndpoint() { return DEFAULT_ENDPOINT; }
const api = new PositionApi((result, t) => {
  state.response = result; state.responseT = t;
  renderReadout(); renderProfileCursor(); updateMapResponse();
}, renderApiStatus, storedEndpoint());

function requestPosition(immediate = false) {
  if (!state.ready) return;
  const p = point();
  if (p.gap) { api.reset(); renderApiStatus({ status: 'error', message: '5秒を超えるGPS欠損区間です。位置予測を停止しています。' }); return; }
  // Resolve the GPS at dispatch time, rather than sending a queued, older sample.
  api.enqueue(() => {
    const latest = point();
    return { body: { latitude: latest.lat, longitude: latest.lon, direction: state.direction, recordedAt: recordedAt(rec(), state.time) }, t: state.time };
  }, null, immediate);
}

function renderApiStatus(status) {
  $('api-button').dataset.status = status.status;
  $('api-badge-text').textContent = status.status === 'ok' ? 'API 接続済み' : status.status === 'error' ? 'API 接続エラー' : 'API 更新中';
  $('api-error').hidden = status.status !== 'error';
  $('api-error-message').textContent = status.message || '';
  if (status.body) $('request-json').textContent = JSON.stringify(status.body, null, 2);
  if (status.result) $('response-json').textContent = JSON.stringify(status.result, null, 2);
  if (status.count) $('request-count').textContent = `${status.count} REQUESTS`;
  if (status.status === 'ok') {
    $('request-latency').textContent = `${status.latency} ms`;
    $('response-status').textContent = `API 5秒周期 · ${status.latency} ms · 最終GPS ${timeLabel(state.responseT)}`;
    const version = status.result.datasetVersion;
    $('dataset-version').textContent = `DATASET ${version?.slice(0, 8) || '—'}`;
    const mismatch = version && version !== data().version;
    $('dataset-version').classList.toggle('mismatch', Boolean(mismatch));
    $('dataset-version').title = mismatch ? 'APIと地図の参照データが異なります。駅ジャンプとグラフはローカル地図データに基づきます。' : `APIとローカル地図のデータ: ${data().version}`;
  } else if (status.status === 'error') {
    state.response = null; state.responseT = null; renderReadout(); updateMapResponse();
    $('response-status').textContent = 'API未接続 · 地図はGPS記録を表示';
    $('response-json').textContent = status.message;
  } else $('response-status').textContent = 'GPSの位置予測を更新中…';
}

function renderReadout() {
  const r = prediction(), station = r?.next.station, river = r?.river, tunnel = r?.next.tunnel;
  applyTunnelTheme(Boolean(r?.position.inTunnel));
  $('station-name').textContent = station?.name || (r ? '記録終端' : '—');
  $('station-romaji').textContent = station ? stations.find(s => s.name === station.name)?.romaji || '' : r ? 'END OF RECORDED ROUTE' : 'WAITING FOR API';
  $('station-eta').textContent = number(station?.etaSeconds);
  $('train-speed').textContent = Number.isFinite(r?.position.speedKmh) ? r.position.speedKmh.toFixed(1) : '—';
  const stationDistance = station?.distanceMeters;
  $('station-distance').textContent = Number.isFinite(stationDistance) && stationDistance >= 1000 ? (stationDistance / 1000).toFixed(2) : number(stationDistance);
  $('station-distance-unit').textContent = stationDistance >= 1000 ? 'km' : 'm';
  $('station-state').textContent = station ? station.arrived ? '停車中 · 到着済み' : r.viewerPrediction ? 'API応答から補間中' : '記録時刻から予測' : r ? '前方の駅はありません' : '応答を待っています';
  $('river-distance').textContent = number(river?.distanceMeters);
  $('river-note').textContent = r?.viewerPrediction ? r.viewerPrediction.riverEstimated ? '根尾川 · 横方向（補間）' : '根尾川 · API取得時の距離' : '根尾川 · 横方向';
  const sides = { east: '東側', west: '西側', on_river: '川上' };
  $('river-side').textContent = sides[river?.side] || '—';
  const signed = river?.signedDistanceMeters;
  $('river-sign').textContent = Number.isFinite(signed) ? `東 + / 西 −　${signed > 0 ? '+' : signed < 0 ? '−' : ''}${number(Math.abs(signed))} m` : river?.status === 'no_intersection' ? 'この位置では川と直交線が交差しません' : '東 + / 西 −';
  $('tunnel-heading').textContent = r?.position.inTunnel ? 'トンネル出口まで' : '次のトンネル';
  $('tunnel-status').textContent = r?.position.inTunnel ? 'IN TUNNEL' : 'OUTSIDE';
  $('tunnel-status').classList.toggle('in-tunnel', Boolean(r?.position.inTunnel));
  $('tunnel-name').textContent = tunnel?.name || (r ? '前方にありません' : '—');
  $('tunnel-eta').textContent = number(tunnel?.etaSeconds);
  $('tunnel-detail').textContent = tunnel ? `${tunnel.target === 'exit' ? '出口' : '入口'}まで` : r ? '登録された記録範囲内' : 'API接続中';
  $('tunnel-distance').textContent = number(tunnel?.distanceMeters);
  $('tunnel-distance-value').hidden = !tunnel;
  $('position-match').textContent = r ? `最終照合のずれ ${r.position.matchOffsetMeters.toFixed(1)} m` : '軌跡とのずれ —';
  if (state.ready) renderLocationText();
}

function applyTunnelTheme(inTunnel) {
  const theme = inTunnel ? 'dark' : 'light';
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = inTunnel ? '#101b19' : '#124e3e';
  updateMapTheme();
}

function updateMapTheme() {
  if (!mapReady) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  map.setConfigProperty('basemap', 'lightPreset', dark ? 'night' : 'day');
  map.setPaintProperty('route-halo', 'line-color', dark ? '#142620' : '#fff');
  map.setPaintProperty('travelled', 'line-color', dark ? '#79b99c' : '#14624b');
  map.setPaintProperty('tunnels', 'line-color', dark ? '#b9efb4' : '#124e3e');
}

function renderLocationText() {
  const p = point();
  const list = [...stations].sort((a, b) => (a.lat - p.lat) ** 2 + ((a.lon - p.lon) * 0.81) ** 2 - ((b.lat - p.lat) ** 2 + ((b.lon - p.lon) * 0.81) ** 2));
  $('position-location').textContent = `${list[0].name}付近 · ${state.direction === 'front' ? '樽見方面' : '本巣方面'}`;
  $('gps-tag').textContent = p.gap ? 'GPS 欠損' : 'RECORDED GPS';
}

function lineFeature(coordinates) { return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }; }
const empty = { type: 'FeatureCollection', features: [] };
function initMap() {
  try {
    const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!accessToken) throw new Error('missing-mapbox-token');
    map = new mapboxgl.Map({ container: 'map', accessToken, center: [136.64, 35.56], zoom: 11, minZoom: 9, maxZoom: 17, maxBounds: [[136.3, 35.3], [136.95, 35.85]],
      attributionControl: { compact: true, customAttribution: '駅・川・トンネル © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>' },
      style: 'mapbox://styles/mapbox/standard',
      config: { basemap: { lightPreset: 'day', show3dObjects: false, showPointOfInterestLabels: false, showTransitLabels: false } }
    });
    map.dragRotate.disable(); map.touchZoomRotate.disableRotation();
    map.on('load', () => {
      mapReady = true;
      for (const name of ['river', 'route', 'travelled', 'river-distance', 'tunnels']) map.addSource(name, { type: 'geojson', data: empty });
      map.addLayer({ id: 'river', type: 'line', slot: 'top', source: 'river', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-emissive-strength': 1, 'line-color': '#90bcae', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 12], 'line-opacity': 0.7 } });
      map.addLayer({ id: 'route-halo', type: 'line', slot: 'top', source: 'route', paint: { 'line-emissive-strength': 1, 'line-color': '#fff', 'line-width': 7 } });
      map.addLayer({ id: 'route', type: 'line', slot: 'top', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-emissive-strength': 1, 'line-color': '#1cb769', 'line-width': 3.5 } });
      map.addLayer({ id: 'travelled', type: 'line', slot: 'top', source: 'travelled', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-emissive-strength': 1, 'line-color': '#14624b', 'line-width': 3.5 } });
      map.addLayer({ id: 'tunnels', type: 'line', slot: 'top', source: 'tunnels', paint: { 'line-emissive-strength': 1, 'line-color': '#124e3e', 'line-width': 5, 'line-dasharray': [0.6, 0.7] } });
      map.addLayer({ id: 'river-distance', type: 'line', slot: 'top', source: 'river-distance', paint: { 'line-emissive-strength': 1, 'line-color': '#ee6755', 'line-width': 1.6, 'line-dasharray': [3, 2] } });
      const el = document.createElement('div'); el.className = 'current-marker'; el.setAttribute('aria-label', 'GPS現在地'); el.innerHTML = '<span></span>';
      marker = new mapboxgl.Marker({ element: el }).setLngLat([point().lon, point().lat]).addTo(map);
      updateRouteMap(); updateMapTheme(); fitMap(false);
    });
    map.on('dragstart', () => setFollow(false));
    map.on('error', () => {
      $('map-error').hidden = false;
      $('map-error').textContent = 'Mapboxの地図を読み込めません。接続とトークンの利用制限を確認してください。';
    });
    map.on('idle', () => { if (mapReady && map.areTilesLoaded()) $('map-error').hidden = true; });
  } catch (error) {
    map?.remove(); map = null;
    $('map-error').hidden = false;
    $('map-error').textContent = error.message === 'missing-mapbox-token'
      ? '.env.local に VITE_MAPBOX_ACCESS_TOKEN を設定してください。簡易マップを表示しています。'
      : 'WebGLが利用できないため座標ベースの簡易マップを表示しています。';
    drawFallbackMap();
    for (const id of ['fit-map', 'follow-map', 'zoom-in', 'zoom-out']) $(id).disabled = true;
  }
}

function updateRouteMap() {
  if (!mapReady) { if (!map) drawFallbackMap(); return; }
  const coords = rec().records.map(r => [r.lon, r.lat]);
  map.getSource('route').setData(lineFeature(coords));
  map.getSource('river').setData(lineFeature(data().river));
  const tunnelFeatures = [];
  for (const entry of data().events.filter(e => e.type === 'tunnel' && e.target === 'entrance')) {
    const exit = data().events.find(e => e.featureId === entry.featureId && e.target === 'exit');
    const points = rec().records.filter(r => r.t >= entry.t && r.t <= exit.t).map(r => [r.lon, r.lat]);
    if (points.length > 1) tunnelFeatures.push(lineFeature(points));
  }
  map.getSource('tunnels').setData({ type: 'FeatureCollection', features: tunnelFeatures });
  stationMarkers.forEach(m => m.remove()); stationMarkers = [];
  for (const station of stations) {
    const event = data().events.find(e => e.type === 'station' && e.name === station.name);
    const el = document.createElement('button'); el.className = `station-marker${event ? '' : ' outside-coverage'}`;
    el.title = event ? `${station.name}の記録位置へ移動` : `${station.name}: この方向のGPS記録範囲外`;
    const tick = document.createElement('span'); tick.className = 'station-tick';
    const name = document.createElement('span'); name.className = 'station-marker-name'; name.textContent = station.name;
    const en = document.createElement('small'); en.textContent = station.romaji;
    name.append(en); el.append(tick, name); el.disabled = !event;
    if (event) el.addEventListener('click', () => seekTo(event.t));
    stationMarkers.push(new mapboxgl.Marker({ element: el, anchor: 'left', offset: [-7, 0] }).setLngLat([station.lon, station.lat]).addTo(map));
  }
  updateMapPosition(); updateMapResponse();
}

function fitMap(animate = true) {
  if (!mapReady) return;
  setFollow(false);
  const bounds = new mapboxgl.LngLatBounds(); stations.forEach(s => bounds.extend([s.lon, s.lat]));
  map.fitBounds(bounds, { padding: { top: 120, bottom: 125, left: 45, right: window.innerWidth < 700 ? 90 : 170 }, duration: animate ? 600 : 0 });
}

function setFollow(value) {
  state.follow = value; $('follow-map').setAttribute('aria-pressed', String(value));
  if (value && mapReady) map.easeTo({ center: [point().lon, point().lat], zoom: 13.5, duration: 500 });
}

function updateMapPosition() {
  const p = point();
  if (!mapReady) { $('fallback-current')?.setAttribute('cx', fallbackXY(p.lon, p.lat)[0]); $('fallback-current')?.setAttribute('cy', fallbackXY(p.lon, p.lat)[1]); return; }
  marker.setLngLat([p.lon, p.lat]);
  const passed = rec().records.filter(r => r.t <= state.time).map(r => [r.lon, r.lat]); passed.push([p.lon, p.lat]);
  map.getSource('travelled').setData(passed.length > 1 ? lineFeature(passed) : empty);
  if (state.follow) map.jumpTo({ center: [p.lon, p.lat] });
}

function updateMapResponse() {
  if (!mapReady) return;
  const river = prediction()?.river;
  map.getSource('river-distance').setData(river?.intersection && river.origin ? lineFeature([[river.origin.longitude, river.origin.latitude], [river.intersection.longitude, river.intersection.latitude]]) : empty);
}

function fallbackXY(lon, lat) { return [80 + (lon - 136.61) * 4400, 90 + (35.6355 - lat) * 3800]; }
function drawFallbackMap() {
  if (!state.ready) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 500 780'); svg.classList.add('fallback-map');
  for (const [coords, color, width] of [[data().river, '#90bcae', 5], [rec().records.map(r => [r.lon, r.lat]), '#1cb769', 3]]) {
    const line = document.createElementNS(svg.namespaceURI, 'polyline'); line.setAttribute('points', coords.map(p => fallbackXY(...p).join(',')).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', color); line.setAttribute('stroke-width', width); svg.append(line);
  }
  for (const s of stations) {
    const [x, y] = fallbackXY(s.lon, s.lat); const text = document.createElementNS(svg.namespaceURI, 'text'); text.setAttribute('x', x + 10); text.setAttribute('y', y + 5); text.textContent = s.name; svg.append(text);
  }
  const circle = document.createElementNS(svg.namespaceURI, 'circle'); circle.id = 'fallback-current'; circle.setAttribute('r', '7'); circle.setAttribute('fill', '#ef6756'); svg.append(circle); $('map').replaceChildren(svg); updateMapPosition();
}

let profileScale = 500;
function buildProfile() {
  const profile = data().profile, [start, end] = range();
  const finite = profile.map(p => Math.abs(p.distance)).filter(Number.isFinite).sort((a, b) => a - b);
  profileScale = Math.max(50, finite[Math.floor(finite.length * 0.92)] || 500);
  const x = t => 4 + (t - start) / (end - start) * 592;
  const y = d => 55 - clamp(d / profileScale, -1, 1) * 43;
  let path = '', continuation = false;
  for (const p of profile) {
    if (!Number.isFinite(p.distance)) { continuation = false; continue; }
    path += `${continuation ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.distance).toFixed(1)} `; continuation = true;
  }
  $('river-chart').innerHTML = `<line x1="0" y1="55" x2="600" y2="55" stroke="#d8e3dc" stroke-dasharray="3 5"/><path d="${path}" fill="none" stroke="#70867d" stroke-width="1.8" vector-effect="non-scaling-stroke"/><line id="profile-cursor" x1="0" x2="0" y1="0" y2="110" stroke="#ef6756" stroke-opacity="0.35"/><circle id="profile-dot" cx="0" cy="55" r="4.8" fill="#ef6756" stroke="white" stroke-width="2"/>`;
  $('river-chart').setAttribute('aria-label', `根尾川への東西距離。上は東、下は西。表示範囲は±${number(profileScale)}m。10秒間隔の参照値。`);
  $('river-chart').closest('.profile-chart').title = `上下 ±${number(profileScale)}m（範囲外は端へ表示）。線は10秒間隔の参照データ、赤点はAPI応答とGPSからの補間。`;
  renderProfileCursor();
}

function renderProfileCursor() {
  if (!state.ready || !$('profile-cursor')) return;
  const [start, end] = range(), x = 4 + (state.time - start) / (end - start) * 592;
  $('profile-cursor').setAttribute('x1', x); $('profile-cursor').setAttribute('x2', x);
  const r = prediction(), d = r?.river.signedDistanceMeters;
  const visible = Number.isFinite(d) && (!r.viewerPrediction || r.viewerPrediction.riverEstimated);
  $('profile-dot').style.display = visible ? '' : 'none';
  if (visible) { $('profile-dot').setAttribute('cx', x); $('profile-dot').setAttribute('cy', 55 - clamp(d / profileScale, -1, 1) * 43); }
}

function buildTimeline() {
  const [start, end] = range(), percent = t => (t - start) / (end - start) * 100;
  $('seek').min = start; $('seek').max = end; $('seek').disabled = false;
  $('timeline-events').replaceChildren();
  for (const entry of data().events.filter(e => e.type === 'tunnel' && e.target === 'entrance')) {
    const exit = data().events.find(e => e.featureId === entry.featureId && e.target === 'exit');
    const span = document.createElement('span'); span.className = 'timeline-tunnel'; span.style.left = `${percent(entry.t)}%`; span.style.width = `${percent(exit.t) - percent(entry.t)}%`; span.title = `${entry.name} · ${timeLabel(entry.t)}–${timeLabel(exit.t)}`; $('timeline-events').append(span);
  }
  const events = data().events.filter(e => e.type === 'station');
  let previous = -Infinity;
  events.forEach((event, index) => {
    const button = document.createElement('button'); button.className = 'timeline-station'; button.style.left = `${clamp(percent(event.t), 0, 99.8)}%`; button.title = `${event.name} · ${timeLabel(event.t)}`; button.setAttribute('aria-label', `${event.name}の記録位置へ`);
    const label = document.createElement('span'); label.textContent = event.name;
    if (percent(event.t) - previous < 8 && index !== events.length - 1) button.classList.add('compact');
    else previous = percent(event.t);
    if (percent(event.t) > 92) button.classList.add('at-end');
    button.append(label); button.addEventListener('click', () => seekTo(event.t)); $('timeline-events').append(button);
  });
  $('timeline-ticks').replaceChildren();
  for (let i = 0; i <= 6; i++) { const tick = document.createElement('span'); tick.textContent = timeLabel(start + (end - start) * i / 6); $('timeline-ticks').append(tick); }
  $('time-end').textContent = timeLabel(end);
  $('sample-count').textContent = `${rec().records.length.toLocaleString('en-US')} GPS POINTS · 1 Hz`;
}

function renderPosition() {
  const [start, end] = range(), p = point();
  $('seek').value = state.time; $('seek-progress').style.width = `${(state.time - start) / (end - start) * 100}%`;
  $('seek').setAttribute('aria-valuetext', `${timeLabel(state.time)} / ${timeLabel(end)}`);
  $('time-current').textContent = timeLabel(state.time);
  $('recorded-time').textContent = `記録時刻 ${clock.format(new Date(recordedAt(rec(), state.time)))} JST`;
  $('latitude').textContent = p.lat.toFixed(6); $('longitude').textContent = p.lon.toFixed(6);
  $('prev-station').disabled = !stationEvent(data().events, state.time, -1);
  $('next-station').disabled = !stationEvent(data().events, state.time, 1);
  $('back-10').disabled = state.time <= start; $('forward-10').disabled = state.time >= end;
  renderLocationText(); renderReadout(); renderProfileCursor(); updateMapPosition(); updateMapResponse();
}

function setPlaying(value) {
  if (!state.ready) return;
  if (value && state.time >= range()[1]) seekTo(range()[0]);
  state.playing = value; lastFrame = performance.now();
  $('play').setAttribute('aria-label', value ? '一時停止' : '再生'); $('play').setAttribute('aria-pressed', String(value));
  $('play').innerHTML = `<i data-lucide="${value ? 'pause' : 'play'}"></i>`; refreshIcons();
  if (!value) api.cancelPending();
}

function seekTo(value) {
  if (!state.ready) return;
  state.time = clamp(Number(value), ...range()); state.response = null; state.responseT = null;
  api.reset(); clearTimeout(seekTimer); lastApiSecond = Math.floor(state.time);
  renderReadout(); renderPosition(); updateMapResponse();
  renderApiStatus({ status: 'loading' });
  seekTimer = setTimeout(() => { seekTimer = null; requestPosition(true); }, 140);
}

function switchDirection(direction) {
  if (!state.ready || direction === state.direction) return;
  setPlaying(false); clearTimeout(seekTimer); api.reset();
  state.direction = direction; state.time = range()[0]; state.response = null; state.responseT = null;
  for (const dir of ['front', 'back']) { $(`${dir}-button`).classList.toggle('selected', direction === dir); $(`${dir}-button`).setAttribute('aria-pressed', String(direction === dir)); }
  $('route-description').textContent = direction === 'front' ? '往路 · 木知原の手前から樽見までの記録' : '復路 · 樽見から織部付近までの記録';
  buildTimeline(); buildProfile(); updateRouteMap(); renderReadout(); renderPosition();
  requestPosition(true);
}

function frame(now) {
  const delta = (now - lastFrame) / 1000; lastFrame = now;
  if (state.ready && state.playing) {
    const advanced = advanceTime(state.time, delta, state.rate, range()[1]); state.time = advanced.time;
    if (now - lastDraw > 45) { renderPosition(); lastDraw = now; }
    const second = Math.floor(state.time);
    if (second !== lastApiSecond && !seekTimer) { lastApiSecond = second; requestPosition(); }
    if (advanced.ended) { setPlaying(false); renderPosition(); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

$('play').addEventListener('click', () => setPlaying(!state.playing));
$('seek').addEventListener('input', e => seekTo(e.target.value));
$('back-10').addEventListener('click', () => seekTo(state.time - 10));
$('forward-10').addEventListener('click', () => seekTo(state.time + 10));
for (const [id, step] of [['prev-station', -1], ['next-station', 1]]) $(id).addEventListener('click', () => { const e = stationEvent(data().events, state.time, step); if (e) seekTo(e.t); });
$('front-button').addEventListener('click', () => switchDirection('front'));
$('back-button').addEventListener('click', () => switchDirection('back'));
$('speed').addEventListener('change', e => { state.rate = Number(e.target.value); });
$('fit-map').addEventListener('click', () => fitMap());
$('follow-map').addEventListener('click', () => setFollow(!state.follow));
$('zoom-in').addEventListener('click', () => map?.zoomIn());
$('zoom-out').addEventListener('click', () => map?.zoomOut());
$('retry-api').addEventListener('click', () => requestPosition(true));
window.addEventListener('keydown', e => {
  if (!state.ready || $('settings-dialog').open || e.target.closest('input, select, textarea, button, a')) return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  if (e.code === 'ArrowLeft') { e.preventDefault(); seekTo(state.time - 10); }
  if (e.code === 'ArrowRight') { e.preventDefault(); seekTo(state.time + 10); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) setPlaying(false); });
function openSettings() { $('endpoint').value = api.endpoint; $('settings-error').textContent = ''; $('settings-dialog').showModal(); }
$('settings-button').addEventListener('click', openSettings); $('api-button').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('click', e => { if (e.target === $('settings-dialog')) { const b = e.target.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) e.target.close(); } });
$('public-endpoint').addEventListener('click', () => { api.endpoint = PUBLIC_ENDPOINT; $('settings-dialog').close(); seekTo(state.time); });
$('reset-endpoint').addEventListener('click', () => { $('endpoint').value = DEFAULT_ENDPOINT; });
$('settings-form').addEventListener('submit', e => {
  e.preventDefault();
  try { api.endpoint = validateEndpoint($('endpoint').value); try { localStorage.setItem('tarumi-api-endpoint', api.endpoint); } catch { /* preferences are optional */ } $('settings-dialog').close(); seekTo(state.time); }
  catch (error) { $('settings-error').textContent = error.message; }
});
$('reload-data').addEventListener('click', () => location.reload());

async function loadJSON(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

try {
  const [front, back, meta, stationData] = await Promise.all(['/data/gps-front.json', '/data/gps-back.json', '/data/map-data.json', '/data/stations.json'].map(loadJSON));
  for (const recording of [front, back]) if (!Array.isArray(recording.records) || recording.records.length < 2 || !Number.isFinite(Date.parse(recording.meta.start_time))) throw new Error('GPSデータの形式を確認してください。');
  recordings = { front, back }; mapData = meta; stations = stationData.stations.filter(s => s.order >= 9);
  routes = Object.fromEntries(Object.entries(recordings).map(([dir, recording]) => [dir, buildRoute(recording.records)]));
  rivers = Object.fromEntries(Object.entries(mapData).map(([dir, d]) => [dir, d.river.map(([lon, lat]) => xy(lat, lon))]));
  state.ready = true; state.time = range()[0];
  buildTimeline(); buildProfile(); renderReadout(); renderPosition(); initMap();
  $('play').disabled = false; $('loading').hidden = true;
  $('route-description').textContent = '往路 · 木知原の手前から樽見までの記録';
  requestPosition(true);
} catch (error) {
  $('loading-message').textContent = `データを読み込めませんでした。${error.message}`; $('reload-data').hidden = false;
}
