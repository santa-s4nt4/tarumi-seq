import * as mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createIcons, TrainFront, Settings2, Scan, LocateFixed, Plus, Minus, Navigation, Waves, Mountain, Info, AudioLines, SkipBack, SkipForward, RotateCcw, RotateCw, Play, Pause, Gauge, X } from 'lucide';
import './style.css';
import './que.css';
import { clamp, sampleAt, recordedAt, timeLabel, advanceTime, stationEvent } from './timeline.js';
import { PositionApi, DEFAULT_ENDPOINT, LOCAL_ENDPOINT, PUBLIC_ENDPOINT, validateEndpoint } from './api.js';
import { buildRoute, interpolatePrediction } from './interpolate.js';
import { xy, distance as coordinateDistance } from './geometry.js';
import { routeBearing, routeLookahead, turnTowards, terrainClearance, OcclusionCamera, cameraChanges } from './camera.js';
import { CueQueue } from './cues.js';
import { createCueCountdown } from './countdown.js';
import { fadeMapTheme } from './theme.js';
import { buildSimulation, simulationPrediction, serviceTime } from './simulation.js';
import { simulationControls } from './simulation-controls.js';
import { createRailProfile, elevatedLineFeature, railLineZOffset } from './rail-elevation.js';


const baseURL = import.meta.env.BASE_URL;
const pagePath = location.pathname.startsWith(baseURL) ? location.pathname.slice(baseURL.length) : location.pathname;
const isQue = /^que(?:\/(?:index\.html)?)?$/.test(pagePath);
const queZoomBounds = { min: 14, max: 20, step: 0.5 };
let queFollowZoom = 19, queBirdZoom = 19, videoMode = false;
try {
  const saved = JSON.parse(localStorage.getItem('tarumi-que-zoom'));
  if (saved?.version === 2 && Number.isFinite(saved.normal) && Number.isFinite(saved.bird)) {
    queFollowZoom = clamp(Math.round(saved.normal * 2) / 2, queZoomBounds.min, queZoomBounds.max);
    queBirdZoom = clamp(Math.round(saved.bird * 2) / 2, queFollowZoom, queZoomBounds.max);
  }
} catch { /* Preferences are optional. */ }
const quePitch = 72;
// Palette from tarumi-oto-fes-main/app/globals.css and its original logo assets.
const queRouteColors = { ahead: '#00ff36', passed: '#bfffcc', river: '#0a84ff', forest: '#1d3a22', plain: '#c4c1b0' };
document.body.classList.toggle('que-view', isQue);
document.title = isQue ? 'QUE | 樽見OTO鉄道' : 'Console | 樽見OTO鉄道';
const $ = id => document.getElementById(id);
const icons = { TrainFront, Settings2, Scan, LocateFixed, Plus, Minus, Navigation, Waves, Mountain, Info, AudioLines, SkipBack, SkipForward, RotateCcw, RotateCw, Play, Pause, Gauge, X };
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.7 } });
refreshIcons();
const navigation = document.createElement('nav');
navigation.className = 'view-navigation';
navigation.setAttribute('aria-label', '画面の切り替え');
navigation.innerHTML = `<a href="${baseURL}console/" ${!isQue ? 'aria-current="page"' : ''}>CONSOLE</a><a href="${baseURL}que/" ${isQue ? 'aria-current="page"' : ''}>QUE</a>`;
document.querySelector('.header-actions').prepend(navigation);
document.querySelector('.brand').href = baseURL;
const countdown = isQue ? createCueCountdown(document.querySelector('.map-panel')) : null;
if (isQue) {
  document.querySelector('.header-center').innerHTML = '<span class="que-title">QUE</span><span class="que-subtitle">景観シーケンサー</span>';
  document.querySelector('.map-heading .eyebrow').textContent = 'TARUMI SOUND RAILWAY';
  document.querySelector('.map-heading h1').id = 'que-route-name';
  document.querySelector('.map-heading').insertAdjacentHTML('beforeend', '<span class="que-route-caption" lang="en">MOTOSU — TARUMI</span>');
  document.querySelector('.map-tools').hidden = true;
  for (const id of ['fit-map', 'follow-map', 'zoom-in', 'zoom-out']) $(id).disabled = true;
  document.querySelector('.map-legend').innerHTML = '<span><b class="legend-line"></b>通過前</span><span><b class="legend-line passed-line"></b>通過済み</span><span><b class="legend-line river-line"></b>根尾川</span><span><b class="legend-position"></b>現在地</span><span><b class="legend-line tunnel-line"></b>トンネル</span><span><b class="legend-line bridge-line"></b>鉄橋</span>';
  const overlay = document.createElement('aside');
  overlay.className = 'cue-overlay';
  overlay.setAttribute('aria-label', '次のキュー');
  overlay.innerHTML = '<div class="cue-heading"><h2>次の合図<span lang="en">UP NEXT</span></h2><span class="cue-source">GPS 記録再生</span><button id="mobile-cue-toggle" class="cue-toggle" type="button" aria-controls="cue-content" aria-expanded="true">非表示</button></div><div id="cue-content"><div id="cue-list"></div><p id="cue-status" role="status">API接続中</p><button id="cue-retry" hidden>再接続</button></div>';
  document.querySelector('.map-panel').append(overlay);
  let mobileCuesVisible = true;
  try { mobileCuesVisible = localStorage.getItem('tarumi-que-mobile-cues') !== 'hidden'; } catch { /* Preferences are optional. */ }
  const renderMobileCues = () => {
    document.body.classList.toggle('mobile-cues-hidden', !mobileCuesVisible);
    $('mobile-cue-toggle').setAttribute('aria-expanded', String(mobileCuesVisible));
    $('mobile-cue-toggle').setAttribute('aria-label', `次の合図を${mobileCuesVisible ? '非表示' : '表示'}`);
    $('mobile-cue-toggle').textContent = mobileCuesVisible ? '非表示' : '表示';
  };
  renderMobileCues();
  $('mobile-cue-toggle').addEventListener('click', () => {
    mobileCuesVisible = !mobileCuesVisible;
    renderMobileCues();
    try { localStorage.setItem('tarumi-que-mobile-cues', mobileCuesVisible ? 'visible' : 'hidden'); } catch { /* Preferences are optional. */ }
  });
  const speedCard = document.createElement('article');
  speedCard.className = 'cue-card cue-primary map-speed-card';
  speedCard.setAttribute('aria-label', '走行速度');
  speedCard.innerHTML = '<h2>走行速度 <span>GPS 記録</span></h2><p><strong id="map-train-speed">—</strong><span class="speed-unit">km/h</span></p><span class="speed-caption" lang="en">TRAIN SPEED</span>';
  document.querySelector('.map-panel').append(speedCard);
  const tunnelBanner = document.createElement('div');
  tunnelBanner.id = 'map-tunnel-banner';
  tunnelBanner.hidden = true;
  tunnelBanner.setAttribute('role', 'status');
  document.querySelector('.map-panel').append(tunnelBanner);
  $('cue-retry').addEventListener('click', () => requestPosition(true));
  const modeBar = document.createElement('div');
  modeBar.className = 'que-view-modes';
  modeBar.setAttribute('role', 'group');
  modeBar.setAttribute('aria-label', '表示モード');
  modeBar.innerHTML = '<span class="que-mode-label">視点<span lang="en">VIEW</span></span>' + [['auto', '自動'], ['normal', '通常固定'], ['bird', '鳥瞰図固定'], ['video', '動画']]
    .map(([mode, label]) => `<button id="que-mode-${mode}" type="button" aria-pressed="false">${label}</button>`).join('');
  document.querySelector('.map-panel').append(modeBar);
  const overlayObserver = new ResizeObserver(updateQueCameraPadding);
  overlayObserver.observe(overlay);
  overlayObserver.observe(document.querySelector('.map-panel'));
  const zoomButton = document.createElement('button');
  zoomButton.id = 'que-zoom-button';
  zoomButton.className = 'secondary-button';
  zoomButton.textContent = '倍率';
  zoomButton.setAttribute('aria-label', '地図の倍率設定');
  zoomButton.setAttribute('aria-haspopup', 'dialog');
  zoomButton.setAttribute('aria-controls', 'que-zoom-dialog');
  $('settings-button').before(zoomButton);
  const zoomDialog = document.createElement('dialog');
  zoomDialog.id = 'que-zoom-dialog';
  zoomDialog.setAttribute('aria-labelledby', 'que-zoom-title');
  zoomDialog.innerHTML = `<div class="dialog-header"><h2 id="que-zoom-title">地図の倍率設定</h2><button id="close-que-zoom" class="icon-button" aria-label="閉じる">×</button></div>
    <p class="field-note">＋で近く、−で広く表示します。</p>
    ${[['normal', '通常ビュー'], ['bird', '鳥瞰図']].map(([mode, label]) => `<div class="que-zoom-row"><span>${label}</span><div class="que-zoom-stepper"><button id="que-${mode}-out" aria-label="${label}を引く">−</button><output id="que-${mode}-zoom" aria-live="polite"></output><button id="que-${mode}-in" aria-label="${label}に寄る">＋</button></div></div>`).join('')}
    <div class="dialog-actions"><button id="reset-que-zoom" class="secondary-button">初期値に戻す</button><button id="done-que-zoom" class="primary-button">完了</button></div>`;
  document.body.append(zoomDialog);
  zoomButton.addEventListener('click', () => zoomDialog.showModal());
  for (const id of ['close-que-zoom', 'done-que-zoom']) $(id).addEventListener('click', () => zoomDialog.close());
  for (const mode of ['normal', 'bird']) for (const [suffix, step] of [['out', -1], ['in', 1]]) {
    $(`que-${mode}-${suffix}`).addEventListener('click', () => setQueZooms(
      mode === 'normal' ? clamp(queFollowZoom + step * queZoomBounds.step, queZoomBounds.min, queBirdZoom) : queFollowZoom,
      mode === 'bird' ? clamp(queBirdZoom + step * queZoomBounds.step, queFollowZoom, queZoomBounds.max) : queBirdZoom));
  }
  for (const mode of ['auto', 'normal', 'bird', 'video']) $(`que-mode-${mode}`).addEventListener('click', () => setQueViewMode(mode));
  $('reset-que-zoom').addEventListener('click', () => setQueZooms(19, 19));
  renderQueZooms();
}
const state = { direction: 'front', time: 0, playing: false, rate: 1, follow: false, response: null, responseT: null, ready: false };
const occlusionCamera = new OcclusionCamera({ pitch: quePitch, zoom: queFollowZoom, birdZoom: queBirdZoom });
if (isQue) {
  try { const mode = localStorage.getItem('tarumi-que-view') ?? 'auto'; videoMode = mode === 'video'; occlusionCamera.setMode(videoMode ? 'auto' : mode, performance.now()); } catch { /* Preferences are optional. */ }
  updateVideoViewer(); renderQueViewMode();
}
const cueQueue = new CueQueue(), cueCards = new Map();
const cameraTerrainHeights = new Map();
let cameraBearing = null, lastCameraFrame = null, lastRequestedCamera = null, nextOcclusionCheck = 0, currentObscured = null, lastHiddenLocation = null, normalSightline = null, clearThreshold = -6, visibilitySettlesAt = 0;
let recordings, mapData, routes, rivers, stations, stationCatalog, timetable, railway, railProfile, railStartS, railEndS, simulation = null, timetableControls, map, mapReady = false, marker, stationMarkers = [], tunnelMarkers = [], seekTimer, lastApiSecond = -1, lastFrame = performance.now(), lastDraw = -Infinity;
const number = value => Number.isFinite(value) ? Math.round(value).toLocaleString('ja-JP') : '—';
const rec = () => simulation?.recording ?? recordings[state.direction];
const data = () => simulation?.data ?? mapData[state.direction];
const range = () => [rec().records[0].t, rec().records.at(-1).t];
const point = () => sampleAt(rec().records, state.time);
function prepareRailRecording(recording) {
  const records = recording.records;
  const first = railProfile.project(records[0].lon, records[0].lat).s;
  const last = railProfile.project(records.at(-1).lon, records.at(-1).lat).s;
  const increasing = last >= first;
  let previous = first;
  for (const record of records) {
    const projected = railProfile.project(record.lon, record.lat, previous).s;
    record.railS = increasing ? Math.max(previous, projected) : Math.min(previous, projected);
    previous = record.railS;
  }
}
function railDistanceAt(time) {
  const records = rec().records;
  if (time <= records[0].t) return records[0].railS;
  if (time >= records.at(-1).t) return records.at(-1).railS;
  let lo = 0, hi = records.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (records[mid].t <= time) lo = mid; else hi = mid;
  }
  const a = records[lo], b = records[hi], gap = b.t - a.t;
  return gap > 5 ? a.railS : a.railS + (b.railS - a.railS) * (time - a.t) / gap;
}
function railPositionAt(time) {
  const s = railDistanceAt(time), [lon, lat] = railProfile.coordinateAt(s);
  return { s, lon, lat, elevationMeters: railProfile.elevationAt(s) };
}
const prediction = () => simulation ? simulationPrediction(simulation, state.time, rivers[state.direction]) : state.ready && !point().gap ? interpolatePrediction(state.response, state.responseT, state.time, routes[state.direction], rivers[state.direction], state.response?.datasetVersion === data().version) : null;
const playbackLabel = seconds => simulation ? serviceTime(seconds, true) : timeLabel(seconds);
const clock = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function storedEndpoint() {
  try { return validateEndpoint(localStorage.getItem('tarumi-api-endpoint')) || DEFAULT_ENDPOINT; }
  catch { return DEFAULT_ENDPOINT; }
}
const api = new PositionApi((result, t) => {
  if (simulation) return;
  state.response = result; state.responseT = t;
  renderReadout(); renderProfileCursor(); updateMapResponse();
}, renderApiStatus, storedEndpoint());

function requestPosition(immediate = false) {
  if (!state.ready || simulation) return;
  const p = point();
  if (p.gap) { api.reset(); renderApiStatus({ status: 'error', message: '5秒を超えるGPS欠損区間です。位置予測を停止しています。' }); return; }
  // Resolve the GPS at dispatch time, rather than sending a queued, older sample.
  api.enqueue(() => {
    const latest = point();
    return { body: { latitude: latest.lat, longitude: latest.lon, direction: state.direction, recordedAt: recordedAt(rec(), state.time) }, t: state.time };
  }, null, immediate);
}

function renderApiStatus(status) {
  if (simulation) return;
  $('api-button').dataset.status = status.status;
  $('api-badge-text').textContent = status.status === 'ok' ? 'API 接続済み' : status.status === 'error' ? 'API 接続エラー' : 'API 更新中';
  $('api-error').hidden = status.status !== 'error';
  $('api-error-message').textContent = status.message || '';
  if (status.body) $('request-json').textContent = JSON.stringify(status.body, null, 2);
  if (status.result) $('response-json').textContent = JSON.stringify(status.result, null, 2);
  if (status.count) $('request-count').textContent = `${status.count} REQUESTS`;
  if (status.status === 'ok') {
    $('request-latency').textContent = `${status.latency} ms`;
    $('response-status').textContent = `API応答後5秒 · ${status.latency} ms · 最終GPS ${timeLabel(state.responseT)}`;
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

let lastCueSignature;
function renderCues(r) {
  if (!isQue) return;
  const events = cueQueue.cards(r);
  countdown.update(events[0]);
  const signature = JSON.stringify([events.map(e => [e.key, e.name, e.type, e.target, number(Math.ceil(e.etaSeconds))]), cueQueue.stopId, Boolean(r?.position.inTunnel), $('api-button').dataset.status]);
  if (signature === lastCueSignature) return;
  lastCueSignature = signature;
  const oldPositions = new Map([...cueCards].map(([key, card]) => [key, card.isConnected ? card.getBoundingClientRect() : null]));
  let needsIcons = false;
  const cards = events.map((event, index) => {
    let card = cueCards.get(event.key);
    if (!card) {
      card = document.createElement('article');
      card.innerHTML = '<div class="cue-card-label" aria-hidden="true"><span class="cue-index"></span><span class="cue-category" lang="en"></span></div><h2></h2><p class="cue-countdown"><span class="cue-seconds"><strong></strong><span class="cue-unit">秒</span></span><span class="cue-kind-icon" aria-hidden="true"></span></p>';
      cueCards.set(event.key, card);
    }
    card.className = `cue-card${index === 0 ? ' cue-primary' : ''}`;
    card.dataset.key = event.key;
    card.dataset.type = event.type;
    card.dataset.target = event.target;
    card.querySelector('.cue-index').textContent = String(index + 1).padStart(2, '0');
    card.querySelector('.cue-category').textContent = event.type === 'station' ? 'STATION' : 'TUNNEL';
    card.querySelector('h2').textContent = event.type === 'station' ? `${event.name}駅まで` : `${event.name}${event.target === 'exit' ? '通過' : ''}まで`;
    card.querySelector('strong').textContent = number(Math.ceil(event.etaSeconds));
    if (card.querySelector('.cue-kind-icon').dataset.type !== event.type) {
      const icon = card.querySelector('.cue-kind-icon');
      icon.dataset.type = event.type;
      icon.innerHTML = event.type === 'station' ? '<i data-lucide="train-front"></i>' : '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 41V22a17 17 0 0 1 34 0v19M14 41V22a10 10 0 0 1 20 0v19M19 28l-5 13m15-13 5 13M18 33h12m-14 5h16"/></svg>';
      needsIcons ||= event.type === 'station';
    }
    return card;
  });
  $('cue-list').replaceChildren(...cards);
  if (needsIcons) refreshIcons();
  for (const event of events) {
    const card = cueCards.get(event.key), previous = oldPositions.get(event.key), current = card.getBoundingClientRect();
    if (previous && Math.abs(previous.y - current.y) > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      card.getAnimations().forEach(animation => animation.cancel());
      card.animate([{ transform: `translateY(${previous.y - current.y}px)` }, { transform: 'translateY(0)' }], { duration: 350, easing: 'ease-out' });
    }
  }
  for (const key of cueCards.keys()) if (!events.some(event => event.key === key)) cueCards.delete(key);
  $('cue-status').textContent = simulation && state.time >= simulation.end ? `${simulation.stops.at(-1).name}駅に到着 · シミュレーション終了` : r ? (cueQueue.stopId ? `${r.next.station.name}駅で停車中` : events.length ? r.position.inTunnel ? 'トンネル内を走行中' : '' : '前方のキューはありません') : $('api-badge-text').textContent;
  $('cue-retry').hidden = $('api-button').dataset.status !== 'error';
}

function renderReadout() {
  const r = prediction(), station = r?.next.station, river = r?.river, tunnel = r?.next.tunnel;
  applyTunnelTheme(Boolean(r?.position.inTunnel));
  if (isQue) {
    $('map-train-speed').textContent = Number.isFinite(r?.position.speedKmh) ? r.position.speedKmh.toFixed(1) : '—';
    $('map-tunnel-banner').hidden = !r?.position.inTunnel;
    $('map-tunnel-banner').textContent = r?.position.inTunnel ? `${tunnel?.name || 'トンネル'}内を走行中` : '';
    for (const m of stationMarkers) m.getElement().classList.toggle('next-station', m.getElement().dataset.station === station?.name);
  }
  renderCues(r);
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
  document.querySelector('meta[name="theme-color"]').content = inTunnel ? (isQue ? '#000000' : '#0b0e12') : '#ffffff';
  if (mapReady) fadeMapTheme(map, updateMapTheme);
}

function updateMapTheme() {
  if (!mapReady) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  if (isQue) {
    map.setConfigProperty('basemap', 'lightPreset', dark ? 'night' : 'day');
    for (const key of ['colorLand', 'colorGreenspace', 'colorCommercial', 'colorEducation', 'colorMedical', 'colorIndustrial']) map.setConfigProperty('basemap', key, dark ? '#18231b' : queRouteColors.plain);
    map.setConfigProperty('basemap', 'colorWater', queRouteColors.river);
    for (const key of ['colorRoads', 'colorMotorways', 'colorTrunks']) map.setConfigProperty('basemap', key, dark ? '#3c5141' : '#e2e0d7');
    map.setPaintProperty('contours', 'line-color', dark ? '#bfffcc' : queRouteColors.forest);
    map.setPaintProperty('terrain-shading', 'hillshade-shadow-color', queRouteColors.forest);
    map.setPaintProperty('terrain-shading', 'hillshade-highlight-color', dark ? '#3c5141' : '#ffffff');
    map.setPaintProperty('terrain-shading', 'hillshade-accent-color', queRouteColors.forest);
    map.setPaintProperty('river', 'line-color', queRouteColors.river);
    map.setPaintProperty('river', 'line-opacity', 1);
    map.setPaintProperty('river', 'line-width', ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 24]);
    map.setPaintProperty('route-halo', 'line-opacity', 0);
    map.setPaintProperty('route', 'line-color', queRouteColors.ahead);
    map.setPaintProperty('travelled', 'line-color', queRouteColors.passed);
    map.setPaintProperty('route', 'line-width', 10);
    map.setPaintProperty('travelled', 'line-width', 10);
    map.setPaintProperty('tunnels', 'line-opacity', 1);
    map.setPaintProperty('tunnels', 'line-color', queRouteColors.ahead);
    map.setPaintProperty('tunnels', 'line-width', 13);
    map.setPaintProperty('tunnels', 'line-dasharray', [0.7, 0.7]);
    map.setPaintProperty('tunnel-halo', 'line-color', '#331e19');
    map.setPaintProperty('bridge-halo', 'line-color', dark ? '#000000' : '#ffffff');
    map.setPaintProperty('bridges', 'line-color', dark ? '#ffffff' : '#331e19');
    map.setPaintProperty('river-distance', 'line-opacity', 0);
    return;
  }
  map.setConfigProperty('basemap', 'lightPreset', dark ? 'night' : 'day');
  const surface = dark ? '#0b0e12' : '#ffffff';
  for (const key of ['colorLand', 'colorGreenspace', 'colorCommercial', 'colorEducation', 'colorMedical', 'colorIndustrial']) map.setConfigProperty('basemap', key, surface);
  map.setConfigProperty('basemap', 'colorWater', dark ? '#000000' : '#ffffff');
  // Mapbox's color parser does not accept CSS 8-digit hex. Use opaque palette blends;
  // Standard also subtracts alpha in its road expressions, so very low alpha is unsafe.
  for (const key of ['colorRoads', 'colorMotorways', 'colorTrunks']) map.setConfigProperty('basemap', key, dark ? '#303943' : '#e1dddd');
  map.setPaintProperty('route-halo', 'line-color', surface);
  map.setPaintProperty('travelled', 'line-color', dark ? '#ffffff' : '#331e19');
  map.setPaintProperty('tunnels', 'line-color', '#18ff14');
  map.setPaintProperty('river-distance', 'line-color', dark ? '#ffffff' : '#000000');
}

function renderLocationText() {
  const p = point();
  const list = [...stations].sort((a, b) => (a.lat - p.lat) ** 2 + ((a.lon - p.lon) * 0.81) ** 2 - ((b.lat - p.lat) ** 2 + ((b.lon - p.lon) * 0.81) ** 2));
  $('position-location').textContent = `${list[0].name}付近 · ${state.direction === 'front' ? '樽見方面' : '本巣方面'}`;
  $('gps-tag').textContent = simulation ? 'TIMETABLE SIMULATION' : p.gap ? 'GPS 欠損' : 'RECORDED GPS';
  if (isQue) {
    $('que-route-name').textContent = state.direction === 'front' ? '本巣 — 樽見' : '樽見 — 本巣';
    document.querySelector('.que-route-caption').textContent = state.direction === 'front' ? 'MOTOSU — TARUMI' : 'TARUMI — MOTOSU';
  }
}

function lineFeature(coordinates) { return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }; }
const empty = { type: 'FeatureCollection', features: [] };
function initMap() {
  try {
    const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!accessToken) throw new Error('missing-mapbox-token');
    map = new mapboxgl.Map({ container: 'map', accessToken, center: isQue ? [point().lon, point().lat] : [136.64, 35.56], interactive: !isQue, zoom: isQue ? queFollowZoom : 11, pitch: isQue ? quePitch : 0, bearing: isQue ? routeBearing(rec().records, state.time, 80) : 0, minZoom: 9, maxZoom: isQue ? queZoomBounds.max : 17, maxBounds: [[136.3, 35.3], [136.95, 35.85]],
      attributionControl: { compact: true, customAttribution: isQue
        ? '駅・川・トンネル・鉄橋 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · 駅周辺標高: <a href="https://maps.gsi.go.jp/development/elevation_s.html" target="_blank" rel="noopener">国土地理院の標高データを加工</a>'
        : '駅・川・トンネル © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>' },
      style: 'mapbox://styles/mapbox/standard',
      config: { basemap: { lightPreset: 'day', theme: 'monochrome', showRoadLabels: false, colorLand: '#ffffff', colorGreenspace: '#ffffff', colorWater: '#ffffff', show3dObjects: false, showPointOfInterestLabels: false, showTransitLabels: false } }
    });
    map.dragRotate.disable(); map.touchZoomRotate.disableRotation();
    map.on('load', () => {
      mapReady = true;
      if (isQue) {
        map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
        map.addSource('topography', { type: 'vector', url: 'mapbox://mapbox.mapbox-terrain-v2' });
        map.addLayer({ id: 'terrain-shading', type: 'hillshade', slot: 'middle', source: 'mapbox-dem', paint: { 'hillshade-exaggeration': 0.4, 'hillshade-emissive-strength': 1, 'hillshade-shadow-color': '#45524a', 'hillshade-highlight-color': '#e2e8df', 'hillshade-accent-color': '#62766a' } });
        map.addLayer({ id: 'contours', type: 'line', slot: 'middle', source: 'topography', 'source-layer': 'contour', minzoom: 10, paint: { 'line-color': '#56655b', 'line-emissive-strength': 1, 'line-opacity': 0.6, 'line-width': ['case', ['>=', ['get', 'index'], 5], 1.2, 0.5] } });
      }
      for (const name of ['river', 'route', 'travelled', 'river-distance', 'tunnels', ...(isQue ? ['bridges'] : [])]) {
        map.addSource(name, { type: 'geojson', data: empty,
          ...(isQue && ['route', 'travelled', 'tunnels', 'bridges'].includes(name) ? { lineMetrics: true } : {}) });
      }
      map.addLayer({ id: 'river', type: 'line', slot: 'top', source: 'river', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-emissive-strength': 1, 'line-color': '#18ff14', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 12], 'line-opacity': 0.25 } });
      map.addLayer({ id: 'route-halo', type: 'line', slot: 'top', source: 'route', paint: { 'line-emissive-strength': 1, 'line-color': '#fff', 'line-width': 7 } });
      map.addLayer({ id: 'route', type: 'line', slot: 'top', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-emissive-strength': 1, 'line-color': '#18ff14', 'line-width': 3.5 } });
      map.addLayer({ id: 'travelled', type: 'line', slot: 'top', source: 'travelled', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-emissive-strength': 1, 'line-color': '#331e19', 'line-width': 3.5 } });
      if (isQue) map.addLayer({ id: 'tunnel-halo', type: 'line', slot: 'top', source: 'tunnels', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-emissive-strength': 1, 'line-color': '#e1d5f0', 'line-width': 18 } });
      map.addLayer({ id: 'tunnels', type: 'line', slot: 'top', source: 'tunnels', paint: { 'line-emissive-strength': 1, 'line-color': '#18ff14', 'line-width': 5, 'line-dasharray': [0.6, 0.7] } });
      if (isQue) {
        map.addLayer({ id: 'bridge-halo', type: 'line', slot: 'top', source: 'bridges', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-emissive-strength': 1, 'line-color': '#fff8e4', 'line-width': 15 } });
        map.addLayer({ id: 'bridges', type: 'line', slot: 'top', source: 'bridges', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-emissive-strength': 1, 'line-color': '#b67517', 'line-width': 7 } });
      }
      map.addLayer({ id: 'river-distance', type: 'line', slot: 'top', source: 'river-distance', paint: { 'line-emissive-strength': 1, 'line-color': '#000000', 'line-width': 1.6, 'line-dasharray': [3, 2] } });
      if (isQue) for (const layer of ['route', 'travelled', 'tunnel-halo', 'tunnels', 'bridge-halo', 'bridges']) {
        // Track height follows a shallow rail profile, independent of the mountains above it.
        map.setLayoutProperty(layer, 'line-elevation-reference', 'sea');
        map.setLayoutProperty(layer, 'line-z-offset', railLineZOffset);
        map.setLayoutProperty(layer, 'line-elevation-ground-scale', 1);
        map.setPaintProperty(layer, 'line-occlusion-opacity', ['tunnel-halo', 'bridge-halo'].includes(layer) ? 0.1 : 0.2);
      }
      const el = document.createElement('div'); el.className = 'current-marker'; el.setAttribute('aria-label', 'GPS現在地');
      el.innerHTML = '<span></span>';
      marker = new mapboxgl.Marker({ element: el, occludedOpacity: 0.2 }).setLngLat([point().lon, point().lat]).addTo(map);
      updateRouteMap(); updateMapTheme(); if (isQue) {
        updateQueCameraPadding();
        setFollow(true);
        map.once('idle', () => applyQueCamera());
      } else fitMap(false);
    });
    if (!isQue) map.on('dragstart', () => setFollow(false));
    map.on('error', () => {
      $('map-error').hidden = false;
      $('map-error').textContent = 'Mapboxの地図を読み込めません。接続とトークンの利用制限を確認してください。';
    });
    map.on('idle', () => { if (mapReady && map.areTilesLoaded()) $('map-error').hidden = true; });
    if (isQue) map.on('render', syncQueMarkers);
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
  const trackFeature = points => isQue ? elevatedLineFeature(railProfile, points) : lineFeature(points);
  if (isQue) {
    railStartS = rec().records[0].railS;
    railEndS = rec().records.at(-1).railS;
  }
  map.getSource('route').setData(trackFeature(isQue ? railProfile.section(railStartS, railEndS) : coords) ?? empty);
  map.getSource('river').setData(lineFeature(data().river));
  const tunnelFeatures = [];
  if (isQue) {
    const low = Math.min(railStartS, railEndS), high = Math.max(railStartS, railEndS);
    for (const tunnel of railway.tunnels) {
      const start = Math.max(low, tunnel.start), end = Math.min(high, tunnel.end);
      if (start < end) {
        const feature = trackFeature(railProfile.section(start, end));
        if (feature) tunnelFeatures.push(feature);
      }
    }
  } else for (const entry of data().events.filter(e => e.type === 'tunnel' && e.target === 'entrance')) {
    const exit = data().events.find(e => e.featureId === entry.featureId && e.target === 'exit');
    if (!exit) continue;
    const points = rec().records.filter(r => r.t >= entry.t && r.t <= exit.t).map(r => [r.lon, r.lat]);
    const a = sampleAt(rec().records, entry.t), b = sampleAt(rec().records, exit.t);
    points.unshift([a.lon, a.lat]); points.push([b.lon, b.lat]);
    if (points.length > 1) tunnelFeatures.push(lineFeature(points));
  }
  map.getSource('tunnels').setData({ type: 'FeatureCollection', features: tunnelFeatures });
  if (isQue) {
    const low = Math.min(railStartS, railEndS), high = Math.max(railStartS, railEndS);
    const features = railway.bridges.flatMap(bridge => {
      const from = Math.max(low, bridge.start), to = Math.min(high, bridge.end);
      const feature = from < to ? elevatedLineFeature(railProfile, railProfile.section(from, to), 12) : null;
      return feature ? [{ ...feature, properties: { ...feature.properties, name: bridge.name, id: bridge.id } }] : [];
    });
    map.getSource('bridges').setData({ type: 'FeatureCollection', features });
  }
  tunnelMarkers.forEach(m => m.remove()); tunnelMarkers = [];
  if (isQue) for (const event of data().events.filter(e => e.type === 'tunnel')) {
    const tunnel = railway.tunnels.find(t => t.id === event.featureId);
    const location = tunnel ? railProfile.coordinateAt(event.target === 'entrance' ? tunnel.start : tunnel.end)
      : [event.location.longitude, event.location.latitude];
    const el = document.createElement('div'); el.className = `tunnel-marker ${event.target}`;
    const portal = document.createElement('span'); portal.className = 'tunnel-portal'; portal.textContent = '∩';
    const label = document.createElement('span'); label.className = 'tunnel-marker-label';
    label.textContent = event.name;
    el.append(portal);
    if (event.target === 'entrance') el.append(label);
    const tunnelMarker = new mapboxgl.Marker({ element: el, occludedOpacity: 0.2, anchor: 'bottom-left', offset: [-14, 0] }).setLngLat(location).addTo(map);
    tunnelMarker.railElevationMeters = railProfile.project(...location).elevationMeters;
    tunnelMarkers.push(tunnelMarker);
  }
  stationMarkers.forEach(m => m.remove()); stationMarkers = [];
  for (const station of stations) {
    const event = data().events.find(e => e.type === 'station' && e.name === station.name);
    const el = document.createElement('button'); el.className = `station-marker${event ? '' : ' outside-coverage'}`;
    el.title = event ? `${station.name}の記録位置へ移動` : `${station.name}: この方向のGPS記録範囲外`;
    el.dataset.station = station.name;
    el.setAttribute('aria-label', `${station.name}駅`);
    const tick = document.createElement('span'); tick.className = 'station-tick';
    if (isQue) tick.textContent = '駅';
    const name = document.createElement('span'); name.className = 'station-marker-name'; name.textContent = station.name;
    const en = document.createElement('small'); en.textContent = station.romaji;
    name.append(en); el.append(tick, name); el.disabled = !event;
    if (event) el.addEventListener('click', () => seekTo(event.t));
    const railStation = isQue ? railway.stations.find(item => item.order === station.order) : null;
    const location = railStation ? [railStation.lon, railStation.lat] : [station.lon, station.lat];
    const stationMarker = new mapboxgl.Marker({ element: el, occludedOpacity: 0.2, anchor: 'left', offset: isQue ? [-14, 0] : [-7, 0] }).setLngLat(location).addTo(map);
    if (isQue) stationMarker.railElevationMeters = railProfile.project(...location).elevationMeters;
    stationMarkers.push(stationMarker);
  }
  updateMapPosition(); updateMapResponse();
}

function fitMap(animate = true) {
  if (!mapReady || isQue) return;
  setFollow(false);
  const bounds = new mapboxgl.LngLatBounds(); stations.forEach(s => bounds.extend([s.lon, s.lat]));
  map.fitBounds(bounds, { padding: { top: 120, bottom: 125, left: 45, right: window.innerWidth < 700 ? 90 : 170 }, duration: animate ? 600 : 0 });
}

function cameraTerrainElevation(lon, lat) {
  // Keep elevations already loaded in normal view available after zooming in.
  const key = `${Math.round(lon * 10000)},${Math.round(lat * 10000)}`;
  const height = map.queryTerrainElevation([lon, lat]);
  if (Number.isFinite(height)) {
    cameraTerrainHeights.set(key, height);
    if (cameraTerrainHeights.size > 5000) cameraTerrainHeights.delete(cameraTerrainHeights.keys().next().value);
    return height;
  }
  return cameraTerrainHeights.get(key) ?? null;
}

function renderQueZooms() {
  if (!isQue) return;
  $('que-normal-zoom').textContent = queFollowZoom.toFixed(1);
  $('que-bird-zoom').textContent = queBirdZoom.toFixed(1);
  $('que-normal-out').disabled = queFollowZoom <= queZoomBounds.min;
  $('que-normal-in').disabled = queFollowZoom >= queBirdZoom;
  $('que-bird-out').disabled = queBirdZoom <= queFollowZoom;
  $('que-bird-in').disabled = queBirdZoom >= queZoomBounds.max;
}

function setQueZooms(normal, bird) {
  queFollowZoom = normal;
  queBirdZoom = bird;
  const now = performance.now();
  occlusionCamera.setZooms(normal, bird, now);
  clearThreshold = -6;
  nextOcclusionCheck = 0;
  visibilitySettlesAt = now + occlusionCamera.duration + 120;
  renderQueZooms();
  try { localStorage.setItem('tarumi-que-zoom', JSON.stringify({ version: 2, normal, bird })); } catch { /* Preferences are optional. */ }
}

function updateVideoViewer() {
  if (!isQue) return;
  document.body.classList.toggle('video-view', videoMode);
  const existing = $('que-video');
  if (!videoMode) { existing?.remove(); return; }
  const videoId = state.direction === 'front' ? 'm-jjJKsWI24' : '7O6dZcTG2mQ';
  if (existing?.dataset.videoId === videoId) return;
  const iframe = document.createElement('iframe');
  iframe.id = 'que-video'; iframe.dataset.videoId = videoId;
  iframe.title = `樽見鉄道 車窓風景 · ${state.direction === 'front' ? '往路 本巣→樽見' : '復路 樽見→本巣'}`;
  iframe.src = `https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0`;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  if (existing) existing.replaceWith(iframe);
  else document.querySelector('.map-panel').append(iframe);
}

function renderQueViewMode() {
  for (const mode of ['auto', 'normal', 'bird', 'video']) $(`que-mode-${mode}`).setAttribute('aria-pressed', String(mode === (videoMode ? 'video' : occlusionCamera.mode)));
}

function setQueViewMode(mode) {
  const now = performance.now();
  videoMode = mode === 'video';
  occlusionCamera.setMode(videoMode ? 'auto' : mode, now);
  updateVideoViewer();
  normalSightline = lastHiddenLocation = null;
  nextOcclusionCheck = 0;
  currentObscured = null;
  visibilitySettlesAt = now + occlusionCamera.duration + 120;
  renderQueViewMode();
  try { localStorage.setItem('tarumi-que-view', mode); } catch { /* Preferences are optional. */ }
}

function queCamera(reset = false, now = performance.now()) {
  const target = routeBearing(rec().records, state.time, 80);
  const delta = lastCameraFrame === null ? 16 : Math.max(0, Math.min(100, now - lastCameraFrame));
  lastCameraFrame = now;
  cameraBearing = reset || cameraBearing === null ? target : turnTowards(cameraBearing, target, 1 - Math.exp(-delta / 350));
  const p = railPositionAt(state.time);
  if (occlusionCamera.mode !== 'auto') return { center: [p.lon, p.lat], ...occlusionCamera.update(null, now), bearing: cameraBearing };
  if (reset || now >= nextOcclusionCheck) {
    nextOcclusionCheck = now + 100;
    const perspective = occlusionCamera.target === occlusionCamera.perspective;
    const settled = now >= Math.max(visibilitySettlesAt, occlusionCamera.startedAt + occlusionCamera.duration + 120);
    if (perspective && settled && map.getPitch() >= quePitch - 0.1) {
      // Preserve the physical normal viewpoint, including Mapbox's terrain
      // safety adjustment. Reconstructing it from requested zoom was inaccurate.
      const eye = map.getFreeCameraOptions().position;
      const ground = cameraTerrainElevation(p.lon, p.lat);
      if (eye && Number.isFinite(ground)) {
        const location = eye.toLngLat();
        normalSightline = { horizontal: coordinateDistance(xy(p.lat, p.lon), xy(location.lat, location.lng)),
          vertical: eye.toAltitude() - p.elevationMeters * 1.5, zoom: queFollowZoom, latitude: p.lat, height: map.getCanvas().clientHeight };
      }
      const opacity = marker?.getElement().style.opacity;
      currentObscured = (ground - p.elevationMeters * 1.5 > 6) || (opacity ? Number(opacity) <= 0.21 : null);
      if (currentObscured) lastHiddenLocation = { xy: xy(p.lat, p.lon), bearing: cameraBearing };
    } else currentObscured = null;

    if (normalSightline && (!perspective || currentObscured === true)) {
      const scale = 2 ** (normalSightline.zoom - queFollowZoom) * map.getCanvas().clientHeight / normalSightline.height *
        Math.cos(p.lat * Math.PI / 180) / Math.cos(normalSightline.latitude * Math.PI / 180);
      const clearance = terrainClearance({ center: p, bearing: cameraBearing,
        horizontal: normalSightline.horizontal * scale, vertical: normalSightline.vertical * scale,
        targetElevation: p.elevationMeters * 1.5, sampleElevation: cameraTerrainElevation });
      // Calibrate against the confirmed 20% marker, then require six metres of
      // additional clearance. Marginal DEM changes cannot immediately reverse it.
      if (perspective && currentObscured === true) clearThreshold = Math.min(-6, Number.isFinite(clearance) ? clearance - 6 : -6);
      else if (settled) {
        currentObscured = clearance === null ? null : clearance >= clearThreshold;
        if (currentObscured === false) {
          // A brief opening between hills should not cause a full mode roundtrip.
          // Check far enough through a curve to avoid a brief return into a hill,
          // including the shorter map viewport beneath the new controls.
          for (const ahead of routeLookahead(rec().records, state.time, 300)) {
            const next = railPositionAt(ahead.t);
            const aheadClearance = terrainClearance({ center: next, bearing: routeBearing(rec().records, ahead.t, 80),
              horizontal: normalSightline.horizontal * scale, vertical: normalSightline.vertical * scale,
              targetElevation: next.elevationMeters * 1.5, sampleElevation: cameraTerrainElevation });
            if (aheadClearance === null) currentObscured = null;
            else if (aheadClearance >= clearThreshold) { currentObscured = true; break; }
          }
        }
        if (lastHiddenLocation && coordinateDistance(xy(p.lat, p.lon), lastHiddenLocation.xy) < 5 &&
            Math.abs(((cameraBearing - lastHiddenLocation.bearing + 540) % 360) - 180) < 5) currentObscured = true;
      }
    }
  }
  return { center: [p.lon, p.lat], ...occlusionCamera.update(currentObscured, now), bearing: cameraBearing };
}

function updateQueCameraPadding() {
  if (!mapReady || !isQue) return;
  const container = map.getContainer(), canvas = map.getCanvas();
  if (canvas.clientWidth !== container.clientWidth || canvas.clientHeight !== container.clientHeight) map.resize();
  // Keep the train in the visible map area above the mobile cue panel.
  const height = document.querySelector('.map-panel').clientHeight;
  const mobile = matchMedia('(max-width: 600px)').matches && (!document.body.classList.contains('countdown-mode') || videoMode);
  const top = mobile ? Math.min(174, height * 0.36) : 0;
  const bottom = mobile ? Math.max(0, Math.min(document.querySelector('.cue-overlay').offsetHeight + 36, height - top - 60)) : 0;
  const padding = map.getPadding();
  if (Math.abs(padding.top - top) > 0.5 || Math.abs(padding.bottom - bottom) > 0.5) {
    map.setPadding({ top, bottom, left: 0, right: 0 });
    lastRequestedCamera = null;
    if (marker) applyQueCamera();
  }
}

function applyQueCamera(reset = false, now = performance.now()) {
  const camera = queCamera(reset, now), changes = cameraChanges(lastRequestedCamera, camera);
  const center = map.getCenter();
  if ('zoom' in changes || 'pitch' in changes || Math.abs(center.lng - camera.center[0]) > 1e-9 ||
      Math.abs(center.lat - camera.center[1]) > 1e-9) changes.center = camera.center;
  if (Object.keys(changes).length) {
    map.jumpTo(changes);
    lastRequestedCamera = camera;
  }
  // Update the moving marker after its camera, in the same animation frame.
  const location = marker?.getLngLat();
  if (marker && (!location || location.lng !== camera.center[0] || location.lat !== camera.center[1])) marker.setLngLat(camera.center);
}

function syncQueMarkers() {
  if (!mapReady) return;
  // Mapbox rounds DOM markers on every jumpTo/moveend. Project once after the
  // map render, retaining subpixels so labels and terrain share the same frame.
  for (const [markers, anchor, offset] of [[[marker], 'translate(-50%,-50%)', 0], [stationMarkers, 'translate(0,-50%)', -14], [tunnelMarkers, 'translate(0,-100%)', -14]]) {
    for (const m of markers) {
      if (!m || m.getElement().hidden) continue;
      const location = m.getLngLat();
      if (m === marker && (m.railLongitude !== location.lng || m.railLatitude !== location.lat)) {
        const projected = railProfile.project(location.lng, location.lat, m.railS);
        m.railLongitude = location.lng; m.railLatitude = location.lat;
        m.railElevationMeters = projected.elevationMeters; m.railS = projected.s;
      }
      // Marker altitude is terrain-relative. Subtract the current DEM height so
      // its absolute height matches the rail line even inside a mountain.
      const ground = map.queryTerrainElevation(location, { exaggerated: true });
      if (Number.isFinite(ground) && Number.isFinite(m.railElevationMeters)) {
        const altitude = m.railElevationMeters * 1.5 - ground;
        if (Math.abs(m.getAltitude() - altitude) > 0.15) m.setAltitude(altitude);
        m.getElement().classList.toggle('terrain-buried', altitude < -6);
      }
      const p = map.project(m.getLngLat(), m.getAltitude());
      m.getElement().style.transform = `translate(${p.x}px,${p.y}px) ${anchor} translate(${offset}px,0)`;
    }
  }
}

function setFollow(value, resetCamera = false) {
  state.follow = isQue || value;
  $('follow-map').setAttribute('aria-pressed', String(state.follow));
  if (!state.follow || !mapReady) return;
  if (isQue) {
    if (resetCamera) {
      occlusionCamera.reset(performance.now());
      nextOcclusionCheck = 0;
      normalSightline = lastHiddenLocation = null;
      clearThreshold = -6;
      visibilitySettlesAt = performance.now() + 200;
    }
    applyQueCamera(resetCamera);
    return;
  }
  map.easeTo({ center: [point().lon, point().lat], zoom: 13.5, pitch: 0, duration: 500 });
}

function updateMapPosition() {
  const p = point();
  if (!mapReady) {
    const [x, y] = fallbackXY(p.lon, p.lat);
    $('fallback-current')?.setAttribute('cx', x);
    $('fallback-current')?.setAttribute('cy', y);
    if (isQue && $('fallback-travelled')) {
      const passed = rec().records.filter(r => r.t <= state.time).map(r => fallbackXY(r.lon, r.lat));
      passed.push(fallbackXY(p.lon, p.lat));
      $('fallback-travelled').setAttribute('points', passed.map(p => p.join(',')).join(' '));
    }
    return;
  }
  if (!isQue) marker.setLngLat([p.lon, p.lat]);
  if (isQue) {
    const currentXY = xy(p.lat, p.lon);
    for (const [markers, radius] of [[stationMarkers, 2200], [tunnelMarkers, 1600]]) for (const m of markers) {
      const location = m.getLngLat();
      m.getElement().hidden = coordinateDistance(currentXY, xy(location.lat, location.lng)) > radius;
    }
  }
  if (isQue) {
    const currentS = railDistanceAt(state.time);
    map.getSource('travelled').setData(elevatedLineFeature(railProfile, railProfile.section(railStartS, currentS)) ?? empty);
  } else {
    const passed = rec().records.filter(r => r.t <= state.time).map(r => [r.lon, r.lat]); passed.push([p.lon, p.lat]);
    map.getSource('travelled').setData(passed.length > 1 ? lineFeature(passed) : empty);
  }
  if (state.follow) {
    if (!isQue) map.jumpTo({ center: [p.lon, p.lat] });
  }
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
  for (const [coords, color, width] of [[data().river, isQue ? queRouteColors.river : '#18ff14', isQue ? 9 : 5], [rec().records.map(r => [r.lon, r.lat]), isQue ? queRouteColors.ahead : '#18ff14', isQue ? 8 : 3]]) {
    const line = document.createElementNS(svg.namespaceURI, 'polyline'); line.setAttribute('points', coords.map(p => fallbackXY(...p).join(',')).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', color); line.setAttribute('stroke-width', width); svg.append(line);
  }
  if (isQue) {
    const passed = document.createElementNS(svg.namespaceURI, 'polyline');
    passed.id = 'fallback-travelled';
    passed.setAttribute('fill', 'none');
    passed.setAttribute('stroke', queRouteColors.passed);
    passed.setAttribute('stroke-width', '8');
    svg.append(passed);
  }
  for (const s of stations) {
    const [x, y] = fallbackXY(s.lon, s.lat); const text = document.createElementNS(svg.namespaceURI, 'text'); text.setAttribute('x', x + 10); text.setAttribute('y', y + 5); text.textContent = s.name; svg.append(text);
  }
  const current = document.createElementNS(svg.namespaceURI, 'circle'); current.id = 'fallback-current';
  current.setAttribute('r', '7'); current.setAttribute('fill', '#331e19');
  svg.append(current); $('map').replaceChildren(svg); updateMapPosition();
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
  $('river-chart').innerHTML = `<line x1="0" y1="55" x2="600" y2="55" stroke="#331e1926" stroke-dasharray="3 5"/><path d="${path}" fill="none" stroke="#000000" stroke-width="1.8" vector-effect="non-scaling-stroke"/><line id="profile-cursor" x1="0" x2="0" y1="0" y2="110" stroke="#331e19" stroke-opacity="0.35"/><circle id="profile-dot" cx="0" cy="55" r="4.8" fill="#331e19" stroke="white" stroke-width="2"/>`;
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
    const span = document.createElement('span'); span.className = 'timeline-tunnel'; span.style.left = `${percent(entry.t)}%`; span.style.width = `${percent(exit.t) - percent(entry.t)}%`; span.title = `${entry.name} · ${playbackLabel(entry.t)}–${playbackLabel(exit.t)}`; $('timeline-events').append(span);
  }
  const events = data().events.filter(e => e.type === 'station');
  let previous = -Infinity;
  events.forEach((event, index) => {
    const button = document.createElement('button'); button.className = 'timeline-station'; button.style.left = `${clamp(percent(event.t), 0, 99.8)}%`; button.title = `${event.name} · ${playbackLabel(event.t)}`; button.setAttribute('aria-label', `${event.name}の${simulation ? '到着時刻' : '記録位置'}へ`);
    const label = document.createElement('span'); label.textContent = event.name;
    if (percent(event.t) - previous < 8 && index !== events.length - 1) button.classList.add('compact');
    else previous = percent(event.t);
    if (percent(event.t) > 92) button.classList.add('at-end');
    button.append(label); button.addEventListener('click', () => seekTo(event.t)); $('timeline-events').append(button);
  });
  $('timeline-ticks').replaceChildren();
  for (let i = 0; i <= 6; i++) { const tick = document.createElement('span'); tick.textContent = simulation ? serviceTime(start + (end - start) * i / 6) : timeLabel(start + (end - start) * i / 6); $('timeline-ticks').append(tick); }
  $('time-end').textContent = playbackLabel(end);
  $('sample-count').textContent = simulation ? `${simulation.train.id}列車 · ${simulation.stops[0].name} → ${simulation.stops.at(-1).name}` : `${rec().records.length.toLocaleString('en-US')} GPS POINTS · 1 Hz`;
}

function renderPosition() {
  const [start, end] = range(), p = point();
  $('seek').value = state.time; $('seek-progress').style.width = `${(state.time - start) / (end - start) * 100}%`;
  $('seek').setAttribute('aria-valuetext', `${playbackLabel(state.time)} / ${playbackLabel(end)}`);
  $('time-current').textContent = playbackLabel(state.time);
  $('recorded-time').textContent = simulation ? `シミュレーション時刻 ${serviceTime(state.time, true)}` : `記録時刻 ${clock.format(new Date(recordedAt(rec(), state.time)))} JST`;
  $('latitude').textContent = p.lat.toFixed(6); $('longitude').textContent = p.lon.toFixed(6);
  $('prev-station').disabled = !stationEvent(data().events, state.time, -1);
  $('next-station').disabled = !stationEvent(data().events, state.time, 1);
  $('back-10').disabled = state.time <= start; $('forward-10').disabled = state.time >= end;
  renderLocationText(); renderReadout(); renderProfileCursor(); updateMapPosition(); updateMapResponse();
}

function setPlaying(value) {
  if (!state.ready) return;
  if (value && state.time >= range()[1]) seekTo(range()[0]);
  if (value && isQue && !state.follow) setFollow(true);
  state.playing = value; lastFrame = performance.now();
  $('play').setAttribute('aria-label', value ? '一時停止' : '再生'); $('play').setAttribute('aria-pressed', String(value));
  $('play').innerHTML = `<i data-lucide="${value ? 'pause' : 'play'}"></i>`; refreshIcons();
  if (!value) api.cancelPending();
}

function seekTo(value) {
  if (!state.ready) return;
  state.time = clamp(Number(value), ...range());
  cueQueue.reset();
  if (isQue) setFollow(true, true);
  state.response = null; state.responseT = null;
  api.reset(); clearTimeout(seekTimer); lastApiSecond = Math.floor(state.time);
  renderReadout(); renderPosition(); updateMapResponse();
  if (!simulation) {
    renderApiStatus({ status: 'loading' });
    seekTimer = setTimeout(() => { seekTimer = null; requestPosition(true); }, 140);
  }
}

function switchDirection(direction) {
  if (!state.ready || direction === state.direction) return;
  if (simulation) { setPlaying(false); timetableControls.open(direction); return; }
  setPlaying(false); clearTimeout(seekTimer); api.reset();
  state.direction = direction; state.time = range()[0]; state.response = null; state.responseT = null;
  if (isQue) updateVideoViewer();
  cueQueue.reset();
  for (const dir of ['front', 'back']) { $(`${dir}-button`).classList.toggle('selected', direction === dir); $(`${dir}-button`).setAttribute('aria-pressed', String(direction === dir)); }
  $('route-description').textContent = direction === 'front' ? '往路 · 木知原の手前から樽見までの記録' : '復路 · 樽見から織部付近までの記録';
  if (isQue) setFollow(true, true);
  buildTimeline(); buildProfile(); updateRouteMap(); renderReadout(); renderPosition();
  requestPosition(true);
}

function simulationMode() {
  updateVideoViewer();
  document.body.classList.toggle('timetable-mode', Boolean(simulation));
  document.querySelector('.playback-title > span').textContent = simulation ? 'TIMETABLE SIMULATION' : 'GPS PLAYBACK';
  document.querySelector('.cue-source').textContent = simulation ? `${simulation.train.id}列車 · ${simulation.selection.day === 'holiday' ? '土曜・休日' : '平日'}` : 'GPS 記録再生';
  document.querySelector('.map-speed-card h2 span').textContent = simulation ? '推定速度' : 'GPS 記録';
  $('seek').setAttribute('aria-label', simulation ? 'シミュレーション時刻' : 'GPSの再生位置');
  $('back-button').querySelector('span').textContent = '本巣方面';
  for (const direction of ['front', 'back']) {
    $(`${direction}-button`).classList.toggle('selected', direction === state.direction);
    $(`${direction}-button`).setAttribute('aria-pressed', String(direction === state.direction));
  }
  $('api-error').hidden = true;
  if (simulation) {
    $('api-button').dataset.status = 'simulation'; $('api-badge-text').textContent = 'ダイヤ再生';
    $('route-description').textContent = `${simulation.train.id}列車 · ${simulation.stops[0].name} → ${simulation.stops.at(-1).name}`;
  } else {
    renderApiStatus({ status: 'loading' });
    $('route-description').textContent = state.direction === 'front' ? '往路 · 木知原の手前から樽見までの記録' : '復路 · 樽見から織部付近までの記録';
  }
  cueQueue.reset(); lastCueSignature = null;
  buildTimeline(); buildProfile(); updateRouteMap(); renderPosition();
  setFollow(true, true);
}

function startSimulation(selection) {
  const next = buildSimulation(timetable, railway, stationCatalog, selection, rivers[timetable.trains.find(t => t.id === selection.trainId)?.direction ?? state.direction]);
  prepareRailRecording(next.recording);
  setPlaying(false); clearTimeout(seekTimer); seekTimer = null; api.reset();
  simulation = next; state.direction = next.train.direction; state.time = next.start;
  state.response = null; state.responseT = null; stations = stationCatalog.filter(station => station.order >= timetable.section.firstStation && station.order <= timetable.section.lastStation);
  simulationMode(); setPlaying(true);
}

function restoreRecording() {
  setPlaying(false); clearTimeout(seekTimer); seekTimer = null; api.reset();
  simulation = null; stations = stationCatalog.filter(station => station.order >= 9);
  state.time = range()[0]; state.response = null; state.responseT = null;
  simulationMode(); requestPosition(true);
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
  if (state.ready && isQue && mapReady && state.follow) applyQueCamera(false, now);
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
$('follow-map').addEventListener('click', () => setFollow(isQue || !state.follow));
$('zoom-in').addEventListener('click', () => map?.zoomIn());
$('zoom-out').addEventListener('click', () => map?.zoomOut());
$('retry-api').addEventListener('click', () => requestPosition(true));
window.addEventListener('keydown', e => {
  if (!state.ready || document.querySelector('dialog[open]')) return;
  if (e.target.closest('input, select, textarea, button, a')) return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  if (e.code === 'ArrowLeft') { e.preventDefault(); seekTo(state.time - 10); }
  if (e.code === 'ArrowRight') { e.preventDefault(); seekTo(state.time + 10); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) setPlaying(false); });
function openSettings() { $('endpoint').value = api.endpoint; $('settings-error').textContent = ''; $('settings-dialog').showModal(); }
$('settings-button').addEventListener('click', openSettings); $('api-button').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('click', e => { if (e.target === $('settings-dialog')) { const b = e.target.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) e.target.close(); } });
$('public-endpoint').addEventListener('click', () => { api.endpoint = PUBLIC_ENDPOINT; try { localStorage.setItem('tarumi-api-endpoint', PUBLIC_ENDPOINT); } catch { /* Preferences are optional. */ } $('settings-dialog').close(); seekTo(state.time); });
$('reset-endpoint').addEventListener('click', () => { $('endpoint').value = LOCAL_ENDPOINT; });
$('settings-form').addEventListener('submit', e => {
  e.preventDefault();
  try { api.endpoint = validateEndpoint($('endpoint').value); try { localStorage.setItem('tarumi-api-endpoint', api.endpoint); } catch { /* preferences are optional */ } $('settings-dialog').close(); seekTo(state.time); }
  catch (error) { $('settings-error').textContent = error.message; }
});
$('reload-data').addEventListener('click', () => location.reload());

async function loadJSON(path) {
  const response = await fetch(`${baseURL}${path.replace(/^\//, '')}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

try {
  const [front, back, meta, stationData] = await Promise.all(['/data/gps-front.json', '/data/gps-back.json', '/data/map-data.json', '/data/stations.json'].map(loadJSON));
  for (const recording of [front, back]) if (!Array.isArray(recording.records) || recording.records.length < 2 || !Number.isFinite(Date.parse(recording.meta.start_time))) throw new Error('GPSデータの形式を確認してください。');
  recordings = { front, back }; mapData = meta; stationCatalog = stationData.stations; stations = stationCatalog.filter(s => s.order >= 9);
  routes = Object.fromEntries(Object.entries(recordings).map(([dir, recording]) => [dir, buildRoute(recording.records)]));
  rivers = Object.fromEntries(Object.entries(mapData).map(([dir, d]) => [dir, d.river.map(([lon, lat]) => xy(lat, lon))]));
  if (isQue) {
    [timetable, railway] = await Promise.all(['/data/timetable.json', '/data/railway-route.json'].map(loadJSON));
    railProfile = createRailProfile(railway);
    for (const recording of Object.values(recordings)) prepareRailRecording(recording);
    timetableControls = simulationControls({ timetable, stations: stationCatalog.filter(station => station.order >= timetable.section.firstStation && station.order <= timetable.section.lastStation), getDirection: () => state.direction, onStart: startSimulation, onRestore: restoreRecording });
  }
  state.ready = true; state.time = range()[0];
  buildTimeline(); buildProfile(); renderReadout(); renderPosition(); initMap();
  $('play').disabled = false; $('loading').hidden = true;
  $('route-description').textContent = '往路 · 木知原の手前から樽見までの記録';
  requestPosition(true);
} catch (error) {
  $('loading-message').textContent = `データを読み込めませんでした。${error.message}`; $('reload-data').hidden = false;
}
