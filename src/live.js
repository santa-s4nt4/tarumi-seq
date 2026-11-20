import './style.css';
import './que.css';
import './live.css';
import './gps-tools.css';
import { liveRequest } from './live-api.js';
import { phoneLink } from './phone-link.js';
import { LiveRecording } from './live-recording.js';
import { timeLabel } from './timeline.js';
import { createIcons, TrainFront } from 'lucide';
import { LivePrediction, LIVE_FRESH_MS } from './live-prediction.js';
import { LiveSession } from './live-session.js';
import { createLiveMap } from './live-map.js';
import { createCueCountdown } from './countdown.js';
import { setupMobileCues } from './mobile-cues.js';
import { LiveTimetable } from './live-timetable.js';
import { createLineMap } from './line-map.js';
import { positionAlong, serviceTime } from './simulation.js';
import { simulationControls } from './simulation-controls.js';
import { japanDate, serviceDayAt } from './timetable-reference.js';
import { setupAppMenu } from './app-menu.js';

const base = import.meta.env.BASE_URL;
const isQue = /(?:^|\/)que(?:\/(?:index\.html)?)?$/.test(location.pathname);
document.title = isQue ? 'QUE · ダイヤと区間 | 樽見OTO鉄道' : 'LIVE · 列車位置 | 樽見OTO鉄道';
document.body.className = 'que-view live-view';
document.documentElement.dataset.theme = 'light';
document.body.innerHTML = `
  <div id="loading" class="loading-overlay" role="status"><span class="loading-logo loading-wordmark" role="img" aria-label="樽見OTO鉄道"></span>
    <h2>全線の時刻表を読み込んでいます</h2><p id="loading-message"></p><button id="reload-data" class="primary-button" hidden>再読み込み</button></div>
  <main class="workspace"><section class="map-panel" aria-label="大垣〜樽見の列車位置">
    <div id="map"></div><div id="line-map" aria-label="全線路線図"><a class="line-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></div>
    <header class="header" aria-label="アプリメニュー"></header>
    <div class="que-view-modes" role="group" aria-label="地図の視点" hidden><button id="live-follow">追従</button><button id="live-bird">鳥瞰</button></div>
    <aside class="cue-overlay" aria-label="次の合図" hidden><div class="cue-heading"><button id="mobile-cue-toggle" class="cue-toggle" type="button" aria-controls="cue-content"></button></div><div id="cue-content"><div id="cue-list"></div></div></aside>
    <article class="cue-card cue-primary map-speed-card" aria-label="推定速度" hidden><p><strong id="map-train-speed">—</strong><span class="speed-unit">km/h</span></p></article>
  </section></main>
  <footer class="playback-panel live-footer">
    <div class="live-status-row"><strong id="live-status" role="status">ダイヤ上の列車位置</strong><time id="live-clock"></time>
      ${isQue ? '<button id="que-select-section" type="button" class="primary-button" disabled>ダイヤ・区間を選ぶ</button>' : ''}</div>
    <div id="live-trains" aria-label="運行中の列車"></div>
    <div class="live-details" hidden><button id="live-overview" class="secondary-button">全線図に戻る</button><span id="live-delay"></span><button type="button" id="live-start" class="secondary-button" aria-pressed="false">乗車中のGPSで遅延補正</button><span id="gps-status" role="status"></span></div>
    ${isQue ? '' : `<div class="gps-tools" aria-label="LIVEのGPS入力">
      <select id="recording-direction" aria-label="GPS記録の方向"><option value="front">往路 · 樽見方面</option><option value="back">復路 · 本巣方面</option></select>
      <button class="secondary-button" id="try-recording" disabled>記録GPSで試す</button>
      <button class="secondary-button" id="phone-link" disabled>スマホのGPSを使う</button>
      <span id="gps-source" class="gps-source-status" role="status"></span></div>`}
    <p class="live-footnote" id="live-note"></p>
  </footer>`;

const $ = id => document.getElementById(id);
$('reload-data').addEventListener('click', () => location.reload());
const navigation = document.createElement('nav');
navigation.className = 'view-navigation';
navigation.setAttribute('aria-label', '画面の切り替え');
navigation.innerHTML = `<a href="${base}console/">CONSOLE</a><a href="${base}que/" ${isQue ? 'aria-current="page"' : ''}>QUE</a><a href="${base}live/" ${isQue ? '' : 'aria-current="page"'}>LIVE</a>`;
const playback = document.createElement('a');
playback.href = `${base}que/?mode=playback`; playback.textContent = '記録・ダイヤを再生';
setupAppMenu({ header: document.querySelector('.header'), navigation, actions: [playback] });
const countdown = createCueCountdown(document.querySelector('.map-panel'));
setupMobileCues($('mobile-cue-toggle'));
const cards = new Map();
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
    text(card.querySelector('.cue-category'), event.type === 'station' ? '駅' : 'トンネル');
    text(card.querySelector('h2'), event.type === 'station' ? `${event.name}駅まで` : `${event.name}${event.target === 'exit' ? '終了' : '開始'}まで`);
    text(card.querySelector('strong'), Number.isFinite(event.etaSeconds) ? String(Math.ceil(event.etaSeconds)) : '—');
    text(card.querySelector('.live-cue-distance'), event.arrived ? '停車中' : `${distance(event.distanceMeters)} · ダイヤ ${serviceTime(event.t, true)}`);

    return card;
  });
  const current = [...$('cue-list').children];
  if (current.length !== active.length || current.some((card, index) => card !== active[index])) $('cue-list').replaceChildren(...active);
  if (icons) createIcons({ icons: { TrainFront }, attrs: { 'stroke-width': 1.7 } });
  for (const key of cards.keys()) if (!events.slice(0, 3).some(event => event.key === key)) cards.delete(key);
}

let fleet, gps, lineMap, terrain, selected = null, mode = 'overview', terrainMode = 'overview', terrainReady = false;
let autoFollow = isQue, gpsStatus = '', lastMapUpdate = -Infinity, focusedCue = null;
let sectionPicker, section = null, completedSection = '', lastPickerSecond;
const trainButtons = new Map();
const gpsMessages = {
  waiting: 'GPS受信待ち', tracking: 'GPS受信中', stale: 'GPS更新待ち',
  accuracy: 'GPS精度不足', 'off-section': '選択区間外のGPSは補正を保留', 'off-route': '路線外', direction: '進行方向を確認してください',
  invalid: 'GPS更新待ち', jump: '位置を再確認中', timeout: 'GPS更新待ち', unavailable: 'GPS受信待ち',
  denied: '位置情報の許可が必要です', unsupported: '位置情報を利用できません', insecure: 'GPSにはHTTPSが必要です',
  hidden: 'GPS補正を一時停止しました', stopped: '', protected: 'カウント中は補正を保留', tunnel: 'トンネル内は補正を保留',
};
let recording = null, loadingRecording = false, phone, phoneStatus = '', sourceNotice = '', measured = null;
const workingFleet = () => recording?.fleet ?? fleet;
const clockNow = () => recording?.now(performance.now()) ?? Date.now();
function acceptFix(position, now = clockNow()) {
  measured = position;
  if (!selected || !selected.activeAt(now)) return;
  if (focusedCue || selected.protectedAt(selected.secondsAt(now))) {
    selected.clearFixes();
    gps.reset();
    gpsStatus = 'protected';
  } else if (gps.accept(position, now, { ignoreTunnels: true })) {
    if (section && (gps.fix.s < section.minS || gps.fix.s > section.maxS)) {
      selected.clearFixes();
      gps.reset();
      gpsStatus = 'off-section';
    } else {
      selected.observe(gps.fix, selected.secondsAt(position.timestamp));
      gpsStatus = 'tracking';
    }
  } else {
    selected.clearFixes();
    gpsStatus = gps.status;
  }
}
const session = new LiveSession({
  onFix(position) { acceptFix(position); render(); },
  onStatus(status) {
    measured = null;
    selected?.clearFixes();
    gps?.reset();
    gpsStatus = status;
  },
});

function selectTrain(run, { chosenSection = null, notice = '' } = {}) {
  if (session.active) session.stop();
  selected?.clearFixes();
  selected = run;
  section = chosenSection;
  completedSection = notice;
  if (run) gps.setDirection(run.train.direction);
  focusedCue = null;
  countdown.update(null);
  gpsStatus = '';
  autoFollow = false;
  setMode(run ? 'follow' : 'overview');
}

function endRecording(message) {
  recording = null;
  measured = null;
  sourceNotice = message;
  gps.reset();
  selectTrain(null);
}

if (!isQue) {
  phone = phoneLink({
    button: $('phone-link'),
    onFix(position) { acceptFix(position); render(); },
    onState(message) {
      if (session.active) session.stop();
      phoneStatus = message;
      sourceNotice = '';
      if (!phone?.active) { measured = null; selected?.clearFixes(); gps?.reset(); gpsStatus = ''; }
    },
  });
  $('try-recording').addEventListener('click', async () => {
    if (recording) { endRecording('現在時刻に戻りました'); return; }
    if (loadingRecording || phone.active) return;
    const direction = $('recording-direction').value;
    loadingRecording = true;
    sourceNotice = 'APIからGPS記録を取得中';
    phoneStatus = '';
    render();
    try {
      const data = await liveRequest('recordings/' + direction);
      if (data.id !== direction || !data.records?.length || !Number.isFinite(Date.parse(data.meta?.start_time))) throw new Error();
      const isolated = new LiveTimetable(fleet.timetable, fleet.railway, fleet.stations);
      recording = new LiveRecording(data, isolated, gps.profile, performance.now());
      selectTrain(recording.train ?? null);
    } catch { sourceNotice = 'GPS記録を取得できませんでした。APIの接続とデータ登録を確認してください。'; }
    finally { loadingRecording = false; render(); }
  });
}

function setMode(value) {
  mode = value;
  lastMapUpdate = -Infinity;
  render();
}

function showFleet(active) {
  for (const [run, button] of trainButtons) {
    if (!active.includes(run)) { button.remove(); trainButtons.delete(run); }
  }
  for (const run of active) {
    if (trainButtons.has(run)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `train-choice ${run.train.direction}`;
    button.textContent = `${run.train.direction === 'front' ? '下り' : '上り'} ${run.train.id}列車 · ${run.stops.at(-1).name}行`;
    button.addEventListener('click', () => selectTrain(run));
    $('live-trains').append(button);
    trainButtons.set(run, button);
  }
}

function createQuePicker(timetable, stations) {
  const name = order => stations.find(station => station.order === order).name;
  function todayRun(id, now) {
    fleet.at(now);
    return fleet.runs.find(run => run.train.id === id && run.epoch === fleet.epoch);
  }
  return simulationControls({
    button: $('que-select-section'), timetable, stations,
    getDirection: () => selected?.train.direction ?? 'front',
    getSelection() {
      const now = Date.now(), { active, next } = fleet.at(now);
      const run = selected ?? active[0] ?? next;
      return section?.choice ?? { trainId: run?.train.id, day: serviceDayAt(now) };
    },
    followStatus(choice, plan) {
      const now = Date.now(), run = todayRun(choice.trainId, now);
      if (!run) return { available: false, message: 'この列車は本日の運行対象外です。' };
      const time = run.secondsAt(now) - run.delay;
      if (time > plan.end) return { available: false, message: '本日のこの区間は終了しました。出発時刻から再生できます。' };
      return { available: true, waiting: time < plan.start, message: '' };
    },
    onFollow(choice, plan) {
      const run = todayRun(choice.trainId, Date.now());
      const label = `${name(choice.stationOrder)} → ${name(choice.endStationOrder)}`;
      const from = run.stops.find(stop => stop.station === choice.stationOrder).s;
      const to = run.stops.find(stop => stop.station === choice.endStationOrder).s;
      selectTrain(run, { chosenSection: { choice, label, start: plan.start, end: plan.end, minS: Math.min(from, to), maxS: Math.max(from, to) } });
    },
    onStart(choice) {
      const params = new URLSearchParams({ mode: 'playback', train: choice.trainId, day: choice.day,
        from: choice.stationOrder, to: choice.endStationOrder });
      location.assign(`${base}que/?${params}`);
    },
  });
}

function render() {
  const tick = performance.now(), now = recording?.now(tick) ?? Date.now();
  if (recording) {
    if (now >= recording.epoch + (recording.end + 1) * 1000) { endRecording('記録が終了し、現在時刻に戻りました'); return; }
    const fix = recording.takeFix(now);
    if (fix) acceptFix(fix, now);
  }
  const { active, seconds, next } = workingFleet().at(now);
  if (focusedCue && tick > focusedCue.deadline + 180) focusedCue = null;
  const runTime = selected?.secondsAt(now);
  const scheduledTime = selected ? runTime - selected.delay : null;
  const waiting = section && scheduledTime < section.start;
  if (section && scheduledTime > section.end && !focusedCue) {
    const message = `${selected.train.id}列車 · ${section.label} の合図は終了しました。`;
    selectTrain(null, { notice: message });
    return;
  }
  if (selected && !section && !active.includes(selected) && !focusedCue) { selectTrain(null); return; }
  if (sectionPicker && Math.floor(now / 1000) !== lastPickerSecond) {
    lastPickerSecond = Math.floor(now / 1000);
    sectionPicker.refreshFollow();
  }
  if (autoFollow && active.length === 1) { selectTrain(active[0]); return; }
  if (active.length > 1) autoFollow = false;
  const prediction = waiting ? null : selected?.snapshot(runTime);
  if (section && prediction) {
    prediction.upcoming = prediction.upcoming.filter(event => event.t > section.start && event.t <= section.end);
    prediction.next.station = prediction.upcoming.find(event => event.type === 'station');
  }
  const upcoming = prediction?.upcoming.map(event => ({ ...event, key: event.id })) ?? [];
  const first = upcoming[0];
  // Latch the actual deadline and identity, including the zero frame when
  // a tunnel entrance immediately becomes an exit in the schedule.
  if (!focusedCue && first?.etaSeconds > 0 && first.etaSeconds <= 10) {
    focusedCue = { event: first, deadline: tick + first.etaSeconds * 1000 };
    selected.lastCountdownTime = Math.max(selected.lastCountdownTime, first.t);
  }
  countdown.update(focusedCue ? { ...focusedCue.event, etaSeconds: Math.max(0, (focusedCue.deadline - tick) / 1000) } : null);
  renderCards(upcoming);
  text($('live-clock'), `${serviceTime(seconds, true)} JST`);
  text($('live-status'), section ? `${selected.train.id}列車 · ${section.label} · ${waiting ? '出発待ち' : '追従中'}` : selected ? `${selected.train.direction === 'front' ? '下り' : '上り'} ${selected.train.id}列車 · ${selected.stops.at(-1).name}行を追従中` :
    active.length ? `全線の列車位置 · ${active.length}本` : 'ダイヤ上、運行中の列車はありません');
  showFleet(active);
  $('live-trains').hidden = Boolean(selected) || !active.length;
  document.querySelector('.live-details').hidden = !selected;
  document.querySelector('.que-view-modes').hidden = !prediction;
  document.querySelector('.cue-overlay').hidden = !prediction;
  document.querySelector('.map-speed-card').hidden = !prediction;
  $('live-follow').setAttribute('aria-pressed', String(mode === 'follow'));
  $('live-bird').setAttribute('aria-pressed', String(mode === 'bird'));
  $('live-start').hidden = Boolean(recording || phone?.active || loadingRecording || (waiting && !session.active));
  $('live-start').setAttribute('aria-pressed', String(session.active));
  text($('live-start'), session.active ? 'GPS補正を停止' : '乗車中のGPSで遅延補正');
  const stale = gpsStatus === 'tracking' && now - gps.fix?.timestamp > LIVE_FRESH_MS;
  text($('gps-status'), gpsMessages[stale ? 'stale' : gpsStatus] ?? '');
  if (!isQue) {
    $('try-recording').disabled = loadingRecording || phone.active;
    $('phone-link').disabled = loadingRecording || Boolean(recording);
    $('recording-direction').disabled = loadingRecording || Boolean(recording) || phone.active;
    text($('try-recording'), recording ? '記録を終了' : '記録GPSで試す');
    const elapsed = recording ? (now - recording.epoch) / 1000 : 0;
    text($('gps-source'), recording ? `記録GPS · ${japanDate(now)} · ${timeLabel(elapsed)} / ${timeLabel(recording.end)} · 青点は記録位置` : sourceNotice || phoneStatus);
  }
  text($('live-delay'), selected?.delay ? `推定遅延 +${selected.delay}秒` : '時刻表基準');
  text($('live-note'), waiting ? `${serviceTime(section.start)} の発車から合図を表示します。` : completedSection || (selected ? '位置・速度・合図は時刻表からの推定です。' :
    active.length ? '時刻表による推定位置です。列車をタップすると追従します。' :
    next ? `次は ${serviceTime(next.start)} ${next.stops[0].name}発、${next.stops.at(-1).name}行です。` : '本日の運行は終了しました。'));
  text($('map-train-speed'), prediction ? prediction.position.speedKmh.toFixed(1) : '—');

  const dark = Boolean(prediction?.position.inTunnel);
  if (document.documentElement.dataset.theme !== (dark ? 'dark' : 'light')) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#ffffff';
    terrain?.setDark(dark);
  }
  if (tick - lastMapUpdate < 500) return;
  lastMapUpdate = tick;
  const trains = active.map(run => {
    const { s } = run === selected && prediction ? prediction.position : positionAlong(run, run.secondsAt(now) - run.delay);
    const [longitude, latitude] = gps.profile.coordinateAt(s);
    return { run, longitude, latitude };
  });
  const focus = prediction && trains.find(train => train.run === selected);
  const cameraMode = focus ? mode : 'overview';
  if (terrainMode !== cameraMode) { terrainMode = cameraMode; terrain?.setMode(cameraMode); }
  $('line-map').hidden = terrainReady;
  $('map').style.visibility = terrainReady ? 'visible' : 'hidden';
  const point = measured && now - measured.timestamp <= LIVE_FRESH_MS ? measured.coords : null;
  if (!terrainReady) lineMap.update(trains, focus, mode, point);
  else terrain.showGps(point);
  terrain?.showTrains(focus ? [] : trains);
  if (focus) {
    Object.assign(prediction.position, { longitude: focus.longitude, latitude: focus.latitude });
    terrain?.update(prediction);
  }
}

$('live-start').addEventListener('click', () => {
  if (session.active) session.stop();
  else if (selected) session.start();
});
$('live-overview').addEventListener('click', () => selectTrain(null));
for (const view of ['follow', 'bird']) $(`live-${view}`).addEventListener('click', () => setMode(view));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session.active) session.stop('hidden');
  if (!document.hidden && fleet) { focusedCue = null; render(); }
});
window.addEventListener('pagehide', () => { if (session.active) session.stop(); });

try {
  const load = async path => {
    const response = await fetch(`${base}data/${path}.json`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(path);
    return response.json();
  };
  const [railway, catalog, reference, timetable] = await Promise.all(['railway-route', 'stations', 'map-data', 'timetable-reference'].map(load));
  gps = new LivePrediction(railway, catalog.stations);
  fleet = new LiveTimetable(timetable, railway, catalog.stations);
  lineMap = createLineMap($('line-map'), gps.profile, gps.stations, reference.front.river, selectTrain);
  terrain = createLiveMap({ profile: gps.profile, river: reference.front.river, stations: gps.stations, onSelect: selectTrain,
    onReady() { terrainReady = true; lastMapUpdate = -Infinity; render(); },
    onError() { terrainReady = false; lastMapUpdate = -Infinity; },
  });
  if (isQue) {
    sectionPicker = createQuePicker(timetable, catalog.stations);
    $('que-select-section').disabled = false;
  }
  render();
  $('loading').hidden = true;
  setInterval(render, 80);
} catch (error) {
  console.error(error);
  text($('loading-message'), '時刻表・路線データを読み込めませんでした。再読み込みしてください。');
  $('reload-data').hidden = false;
}
