import './style.css';
import './que.css';
import './live.css';
import { createIcons, TrainFront } from 'lucide';
import { LivePrediction } from './live-prediction.js';
import { LiveSession } from './live-session.js';
import { createLiveMap } from './live-map.js';
import { createCueCountdown } from './countdown.js';
import { setupMobileCues } from './mobile-cues.js';

const base = import.meta.env.BASE_URL;
document.title = 'LIVE GPS | 樽見OTO鉄道';
document.body.className = 'que-view live-view';
document.documentElement.dataset.theme = 'light';
document.body.innerHTML = `
  <header class="header">
    <a class="brand" href="${base}" aria-label="樽見OTO鉄道"><span class="brand-logo" role="img" aria-label="樽見OTO鉄道"></span></a>
    <div class="header-center"><span class="que-title">LIVE</span><span class="que-subtitle">現在地で合図を出す</span></div>
    <div class="header-actions"><nav class="view-navigation" aria-label="画面の切り替え"><a href="${base}console/">CONSOLE</a><a href="${base}que/">QUE</a><a href="${base}live/" aria-current="page">LIVE</a></nav><span class="live-badge" id="live-badge">GPS 停止中</span></div>
  </header>
  <main class="workspace"><section class="map-panel" aria-label="リアルタイムGPSマップ">
    <div id="map"></div>
    <div class="map-heading"><span class="eyebrow">TARUMI SOUND RAILWAY</span><h1 id="live-route">大垣 — 樽見</h1><p>現在地と実測速度に合わせた合図</p><span class="que-route-caption">LIVE GPS / ON THE LINE</span></div>
    <div class="que-view-modes" role="group" aria-label="地図の視点"><span class="que-mode-label">視点</span><button id="live-follow" aria-pressed="true">追従</button><button id="live-bird" aria-pressed="false">鳥瞰</button><button id="live-overview" aria-pressed="false">全体</button></div>
    <aside class="cue-overlay" aria-label="次のキュー"><div class="cue-heading"><h2>次の合図<span lang="en">UP NEXT</span></h2><span class="cue-source">LIVE GPS</span><button id="mobile-cue-toggle" class="cue-toggle" type="button" aria-controls="cue-content" aria-expanded="true">非表示</button></div><div id="cue-content"><div id="cue-list"></div><p id="cue-status" role="status">GPSの開始を待っています</p></div></aside>
    <article class="cue-card cue-primary map-speed-card" aria-label="現在の走行速度"><h2>走行速度 <span id="live-speed-source">端末GPS</span></h2><p><strong id="map-train-speed">—</strong><span class="speed-unit">km/h</span></p><span class="speed-caption">LIVE SPEED</span></article>
    <div class="map-legend"><span><b class="legend-line"></b>線路</span><span><b class="legend-line river-line"></b>根尾川</span><span><b class="legend-position"></b>現在地</span><span><b class="legend-line tunnel-line"></b>トンネル</span></div>
    <div id="map-tunnel-banner" role="status" hidden></div>
    <div class="live-notice" id="live-notice"><span class="eyebrow">REALTIME GPS</span><h2 id="live-notice-title">スマホのGPSで、合図を出す。</h2><p id="live-notice-message">方面を選び、GPS取得を開始してください。現在地と速度をこの端末内で線路に照合します。位置情報の許可が必要です。</p><button id="live-start-here" class="primary-button" disabled>GPS取得を開始</button></div>
    <p class="live-map-error" id="live-map-error" role="status" hidden></p>
  </section></main>
  <footer class="playback-panel live-footer" aria-label="リアルタイムGPSの操作">
    <div class="live-status-row"><strong id="live-status" role="status">路線データを読み込み中</strong><span id="live-quality">精度 —</span><span id="live-age">更新 —</span></div>
    <div class="live-controls"><button id="live-start" class="primary-button" disabled>GPS取得を開始</button><button id="live-stop" class="secondary-button" disabled>停止</button><div class="direction-tabs" role="group" aria-label="実際の進行方向"><button id="live-front" class="selected" aria-pressed="true">下り<span>樽見方面</span></button><button id="live-back" aria-pressed="false">上り<span>大垣方面</span></button></div></div>
    <p class="live-footnote">秒数は現在の速度による目安です。画面を開いたままご利用ください。GPS更新が途切れると合図を止めます。</p>
  </footer>`;

const $ = id => document.getElementById(id);
const viewButtons = ['live-front', 'live-back', 'live-follow', 'live-bird', 'live-overview'];
for (const id of viewButtons) $(id).disabled = true;
const countdown = createCueCountdown(document.querySelector('.map-panel'));
setupMobileCues($('mobile-cue-toggle'));
let model, liveMap, loaded = false, status = 'idle', previousTheme = 'light', lastMapUpdate = -Infinity;
const cards = new Map();
const messages = {
  idle: ['GPS取得を開始できます', 'スマホのGPSで、合図を出す。', '方面を選び、GPS取得を開始してください。現在地と速度をこの端末内で線路に照合します。位置情報の許可が必要です。'],
  waiting: ['現在地を取得しています', '現在地を取得しています', '位置情報を許可し、GPSの届く場所でお待ちください。'],
  stopped: ['GPS 停止中', 'GPSを停止しました', 'もう一度開始すると、現在地から合図を再開します。'],
  hidden: ['画面が非表示になったため停止しました', 'GPSを一時停止しました', '画面を開いたまま「GPS取得を開始」で再開してください。'],
  denied: ['位置情報が許可されていません', '位置情報を許可してください', 'ブラウザーのサイト設定で位置情報を許可してから、もう一度開始してください。'],
  insecure: ['HTTPSのページでご利用ください', 'HTTPSの公開URLで開いてください', 'スマホでは公開されたHTTPSの /live/ ページから位置情報を利用できます。'],
  unsupported: ['このブラウザーではGPSを利用できません', '位置情報に対応したブラウザーで開いてください', 'スマートフォンの標準ブラウザーでお試しください。'],
  unavailable: ['現在地を取得できません', 'GPSの受信を待っています', '端末の位置情報設定と受信状況を確認してください。位置が取得できると再開します。'],
  timeout: ['GPSの受信を待っています', 'GPSの受信を待っています', 'トンネル内や窓から離れた場所では、位置情報を取得できない場合があります。'],
  stale: ['GPS更新待ち · 合図を停止中', 'GPSの更新が途切れています', '新しい位置情報が届くまで、秒数や現在地を進めずに待機します。'],
  accuracy: ['測位精度を確認中 · 合図を停止中', 'GPSの精度を確認しています', '精度が50m以内になると合図を再開します。端末を窓側に近づけてお待ちください。'],
  'off-route': ['樽見線の路線外 · 合図を停止中', '樽見線の線路付近でご利用ください', '現在地が線路から100m以上離れています。路線付近に入ると合図を開始します。'],
  direction: ['進行方向を確認してください', '選択した方面と逆向きに移動しています', '下部の「下り／上り」を、実際の列車の進行方向に合わせてください。'],
  jump: ['GPS位置を確認中 · 合図を停止中', 'GPS位置が大きく変化しました', '新しい位置情報を確認するまで合図を止めています。'],
  invalid: ['GPS位置を確認中', '現在地を取得できません', '新しい位置情報を待っています。'],
};
const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
const distance = value => value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`;

function renderCards(events) {
  let icons = false;
  const active = events.slice(0, 3).map((event, index) => {
    let card = cards.get(event.key);
    if (!card) {
      card = document.createElement('article');
      card.innerHTML = '<div class="cue-card-label"><span class="cue-index"></span><span class="cue-category"></span></div><h2></h2><p class="cue-countdown"><span class="cue-seconds"><strong></strong><span class="cue-unit">秒</span></span><span class="cue-kind-icon" aria-hidden="true"></span></p><p class="live-cue-distance"></p>';
      card.querySelector('.cue-kind-icon').innerHTML = event.type === 'station' ? '<i data-lucide="train-front"></i>' : '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 41V22a17 17 0 0 1 34 0v19M14 41V22a10 10 0 0 1 20 0v19M19 28l-5 13m15-13 5 13M18 33h12m-14 5h16"/></svg>';
      icons ||= event.type === 'station'; cards.set(event.key, card);
    }
    card.className = `cue-card${index === 0 ? ' cue-primary' : ''}`;
    text(card.querySelector('.cue-index'), String(index + 1).padStart(2, '0'));
    text(card.querySelector('.cue-category'), event.type === 'station' ? 'STATION' : 'TUNNEL');
    text(card.querySelector('h2'), event.type === 'station' ? `${event.name}駅まで` : `${event.name}${event.target === 'exit' ? '通過' : ''}まで`);
    text(card.querySelector('strong'), Number.isFinite(event.etaSeconds) ? String(Math.ceil(event.etaSeconds)) : '—');
    text(card.querySelector('.live-cue-distance'), event.arrived ? '駅付近 · 停車中' : `${distance(event.distanceMeters)} · 到着の目安`);
    return card;
  });
  const current = [...$('cue-list').children];
  if (current.length !== active.length || current.some((card, index) => card !== active[index])) $('cue-list').replaceChildren(...active);
  if (icons) createIcons({ icons: { TrainFront }, attrs: { 'stroke-width': 1.7 } });
  for (const key of cards.keys()) if (!events.slice(0, 3).some(event => event.key === key)) cards.delete(key);
}

const session = new LiveSession({
  onFix(position) { model?.accept(position); render(); },
  onStatus(value) {
    status = value;
    if (model) { if (value === 'waiting' || !session.active) model.reset(); else model.status = value; }
    render();
  },
});

function render() {
  if (!loaded) return;
  const snapshot = session.active ? model.snapshot() : { status, prediction: null, measurement: model.measurement };
  const prediction = snapshot.prediction;
  const state = prediction ? 'tracking' : snapshot.status;
  const info = messages[state] ?? messages.idle;
  const event = prediction?.upcoming[0];
  renderCards(prediction?.upcoming ?? []);
  countdown.update(event);
  text($('live-status'), prediction ? prediction.position.speedMetersPerSecond === null ? 'GPS受信中 · 速度を計測しています' : 'GPS受信中' : info[0]);
  text($('live-badge'), session.active ? 'GPS 取得中' : 'GPS 停止中');
  $('live-badge').dataset.active = String(session.active);
  text($('live-quality'), Number.isFinite(snapshot.measurement?.accuracy) ? `精度 ±${Math.round(snapshot.measurement.accuracy)}m` : '精度 —');
  text($('live-age'), snapshot.measurement ? `更新 ${Math.max(0, Math.floor((Date.now() - snapshot.measurement.timestamp) / 1000))}秒前` : '更新 —');
  text($('map-train-speed'), Number.isFinite(prediction?.position.speedKmh) ? prediction.position.speedKmh.toFixed(1) : '—');
  text($('live-speed-source'), prediction?.position.speedSource === 'position-difference' ? '位置差分の推定' : '端末GPS');
  text($('cue-status'), prediction ? prediction.position.speedMetersPerSecond === null ? '速度を取得すると秒数を表示します' : prediction.position.speedMetersPerSecond < 0.8 ? '停車・低速中は時間の予測を止めます' : '現在地と実測速度による目安です' : info[0]);
  $('live-notice').hidden = Boolean(prediction);
  text($('live-notice-title'), info[1]); text($('live-notice-message'), info[2]);
  $('live-start-here').hidden = session.active;
  $('live-start').disabled = session.active; $('live-start-here').disabled = session.active;
  $('live-stop').disabled = !session.active;
  $('map-tunnel-banner').hidden = !prediction?.position.inTunnel;
  if (prediction?.position.inTunnel) text($('map-tunnel-banner'), `${prediction.next.tunnel?.name ?? 'トンネル'}内を走行中`);
  if (prediction) {
    const theme = prediction.position.inTunnel ? 'dark' : 'light';
    if (theme !== previousTheme) {
      previousTheme = theme; document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#000000' : '#ffffff';
      liveMap?.setDark(theme === 'dark');
    }
    if (performance.now() - lastMapUpdate > 550) { liveMap?.update(prediction); lastMapUpdate = performance.now(); }
  } else liveMap?.stale();
}

for (const id of ['live-start', 'live-start-here']) $(id).addEventListener('click', () => { if (loaded) session.start(); });
$('live-stop').addEventListener('click', () => session.stop());
for (const direction of ['front', 'back']) $(`live-${direction}`).addEventListener('click', () => {
  if (!loaded) return;
  model.setDirection(direction); status = session.active ? 'waiting' : 'idle';
  for (const value of ['front', 'back']) { $(`live-${value}`).classList.toggle('selected', value === direction); $(`live-${value}`).setAttribute('aria-pressed', String(value === direction)); }
  text($('live-route'), direction === 'front' ? '大垣 — 樽見' : '樽見 — 大垣');
  lastMapUpdate = -Infinity; render();
});
for (const mode of ['follow', 'bird', 'overview']) $(`live-${mode}`).addEventListener('click', () => {
  liveMap?.setMode(mode);
  for (const value of ['follow', 'bird', 'overview']) $(`live-${value}`).setAttribute('aria-pressed', String(value === mode));
});
document.addEventListener('visibilitychange', () => { if (document.hidden && session.active) session.stop('hidden'); });
window.addEventListener('pagehide', () => { if (session.active) session.stop(); });

try {
  const load = async path => { const response = await fetch(`${base}data/${path}`, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error('路線データの読み込みに失敗しました'); return response.json(); };
  const [railway, catalog, reference] = await Promise.all(['railway-route.json', 'stations.json', 'map-data.json'].map(load));
  model = new LivePrediction(railway, catalog.stations);
  liveMap = createLiveMap({ profile: model.profile, river: reference.front.river, stations: model.stations,
    onError(message) { text($('live-map-error'), message); $('live-map-error').hidden = false; } });
  loaded = true;
  for (const id of viewButtons) $(id).disabled = false;
  render();
  setInterval(render, 80);
} catch {
  text($('live-status'), '路線データを読み込めません');
  text($('live-notice-title'), '路線データを読み込めません');
  text($('live-notice-message'), '通信状態を確認して、ページを再読み込みしてください。');
}
