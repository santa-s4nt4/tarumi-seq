import './style.css';
import './que.css';
import './live.css';
import { createModeMenu } from './mode-menu.js';
import { createJourneyMap } from './journey-map.js';
import { createStationTimeline } from './station-timeline.js';
import { createCueCountdown } from './countdown.js';
import { CueQueue } from './cues.js';
import { createRailProfile } from './rail-elevation.js';
import { LiveTimetable } from './live-timetable.js';
import { LivePrediction } from './live-prediction.js';
import { customPlan, nearestRun, directionName } from './journey.js';
import { positionAlong, scheduledEventsAt, serviceTime } from './simulation.js';
import { japanDate, serviceDayEpoch, serviceDayAt } from './timetable-reference.js';
import './experience.css';

const base = import.meta.env.BASE_URL, url = new URL(location.href);
const route = url.pathname.slice(base.length).replace(/index\.html$/, '').split('/')[0] || 'home';
const isCustom = route === 'custom', isPerformance = import.meta.env.DEV && route === 'performance';
document.title = `${route === 'home' ? '' : route.toUpperCase() + ' | '}樽見OTO鉄道`;
document.body.className = `experience ${route}-experience`;
document.documentElement.dataset.theme = 'light';
document.body.innerHTML = `<main class="journey-workspace"><section class="map-panel" aria-label="樽見鉄道の路線地図">
  <div id="map"></div><div id="line-map" aria-label="全線路線図"><a class="line-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></div>
  <button id="journey-menu" aria-label="メニューを開く" aria-haspopup="dialog"><span></span><span></span><span></span></button>
  <div class="journey-views" role="group" aria-label="地図の視点" hidden>
    <button data-view="auto" aria-pressed="true">自動</button><button data-view="normal" aria-pressed="false">進行方向</button><button data-view="bird" aria-pressed="false">鳥瞰</button>${isCustom ? '<button data-view="video" aria-pressed="false">車窓</button>' : ''}
  </div>
  <aside class="cue-overlay" aria-label="次の合図" hidden><div id="cue-list"></div></aside>
  <div class="journey-instruments" hidden><p aria-label="ダイヤからの推定速度"><strong id="journey-speed">0.0</strong><span>km/h</span></p><time id="journey-clock" aria-label="${isCustom ? '再生時刻' : '現在時刻'}"></time></div>
  <div class="journey-legend" aria-label="地図の凡例"><span><i class="river"></i>河川</span><span><i class="bridge"></i>橋梁</span><span><i class="tunnel"></i>トンネル</span></div>
  <p id="journey-status" role="status"></p>
  ${isPerformance ? '<div class="performance-controls" hidden><label>乗車列車 <select id="performance-train" aria-label="乗車列車"><option value="">GPSから自動選択</option></select></label><span id="performance-status" role="status"></span></div>' : ''}
  </section></main>${isCustom ? '<footer id="custom-timeline" hidden></footer>' : ''}
  <div id="loading" class="loading-overlay" role="status"><h2>路線と時刻表を読み込んでいます</h2><p></p><button id="reload-data" hidden>再読み込み</button></div>`;
const $ = id => document.getElementById(id), panel = document.querySelector('.map-panel');
$('reload-data').onclick = () => location.reload();
const countdown = createCueCountdown(panel);
const queue = new CueQueue();
let profile, map, fleet, timetable, railway, stations, selected, plan, timeline, menu, phone, gps;
let time = 0, playing = false, resumeAfterMenu = false, view = 'auto', lastFrame, lastMap = -Infinity, measured = null;
let menuHasTrain = false, menuTransitionDuration = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden && isCustom) { playing = false; resumeAfterMenu = false; lastFrame = undefined; } });
const cards = new Map();
const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
const trainIcon = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="10" y="5" width="28" height="32" rx="12"/><path d="M16 37l-4 7m20-7 4 7M18 13h12M16 19v6m16-6v6"/><circle cx="18" cy="31" r="1"/><circle cx="30" cy="31" r="1"/></svg>';
const tunnelIcon = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 41V22a17 17 0 0 1 34 0v19M14 41V22a10 10 0 0 1 20 0v19M19 28l-5 13m15-13 5 13M18 33h12m-14 5h16"/></svg>';
function renderCards(events) {
  const active = events.slice(0, 3).map((event, index) => {
    let card = cards.get(event.id);
    if (!card) {
      card = document.createElement('article');
      card.innerHTML = `<div class="cue-card-label"><span class="cue-index"></span><span class="cue-category"></span></div><h2></h2><p class="cue-countdown"><span class="cue-seconds"><strong></strong><span class="cue-unit">秒</span></span><span class="cue-kind-icon">${event.type === 'station' ? trainIcon : tunnelIcon}</span></p><p class="journey-cue-note"></p>`;
      cards.set(event.id, card);
    }
    const className = 'cue-card' + (index === 0 ? ' cue-primary' : '');
    if (card.className !== className) card.className = className;
    text(card.querySelector('.cue-index'), String(index + 1).padStart(2, '0'));
    text(card.querySelector('.cue-category'), event.type === 'station' ? '駅' : 'トンネル');
    text(card.querySelector('h2'), `${event.name}${event.type === 'station' ? '駅' : event.target === 'exit' ? '終了' : '開始'}まで`);
    text(card.querySelector('strong'), String(Math.ceil(event.etaSeconds)));
    text(card.querySelector('.journey-cue-note'), event.arrived ? '停車中' : `ダイヤ ${serviceTime(event.t, true)}${!isCustom && selected?.delay ? ` · ${selected.delay}秒遅れ` : ''}`);
    return card;
  });
  const children = [...$('cue-list').children];
  if (children.length !== active.length || children.some((child, i) => child !== active[i])) $('cue-list').replaceChildren(...active);
  for (const key of cards.keys()) if (!events.slice(0, 3).some(event => event.id === key)) cards.delete(key);
}
function navigate(route, params) {
  const target = new URL(base + route + '/', location.origin);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  location.assign(target);
}
function setView(mode, share = true) {
  view = mode; map.setMode(mode === 'video' ? 'auto' : mode);
  document.body.classList.toggle('video-view', mode === 'video');
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === mode));
  $('journey-video')?.remove();
  if (mode === 'video' && plan) {
    const iframe = document.createElement('iframe'); iframe.id = 'journey-video';
    iframe.title = '樽見鉄道 車窓風景'; iframe.src = `https://www.youtube.com/embed/${plan.train.direction === 'front' ? 'm-jjJKsWI24' : '7O6dZcTG2mQ'}?playsinline=1&rel=0`;
    iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture'; iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'; panel.append(iframe);
  }
  if (share) publishView();
}
function publishView() { if (phone && !phone.viewer) phone.publish({ trainId: selected?.train.id ?? null, date: japanDate(Date.now()), delay: selected?.delay ?? 0, mode: view }); }
function selectTrain(run, share = true) {
  selected = run; gps?.setDirection(run.train.direction); map.reset(); queue.reset();
  if (isPerformance) $('performance-train').value = run.train.id;
  if (share) publishView();
}
function isMenuOpen() { return menu?.active || phone?.dialog.open; }
function acceptFix(position) {
  measured = position;
  if (phone?.viewer) return;
  const now = Date.now(), { active } = fleet.at(now);
  if (!selected) {
    const match = nearestRun(active, profile, position, now);
    if (match) selectTrain(match);
  }
  if (!selected) return;
  if (selected.protectedAt(selected.secondsAt(now))) { selected.clearFixes(); gps.reset(); return; }
  if (gps.accept(position, now, { ignoreTunnels: true })) {
    if (selected.observe(gps.fix, selected.secondsAt(position.timestamp))) publishView();
  } else selected.clearFixes();
}
function seek(value) { time = timeline.range.clamp(value); if (time >= timeline.range.end) playing = false; map.reset(); queue.reset(); countdown.update(null); }
function updateRange(range) {
  seek(time);
  const current = new URL(location.href);
  current.searchParams.set('from', plan.stops[range.first].station); current.searchParams.set('to', plan.stops[range.last].station);
  history.replaceState(null, '', current);
}
function render(frame) {
  requestAnimationFrame(render);
  const elapsed = lastFrame === undefined ? 0 : Math.max(0, (frame - lastFrame) / 1000); lastFrame = frame;
  if (playing && timeline && !isMenuOpen()) {
    time = timeline.range.clamp(time + elapsed); if (time >= timeline.range.end) playing = false;
  }
  const now = Date.now(), { active } = fleet.at(now);
  let prediction = null, seconds = (now - serviceDayEpoch(japanDate(now))) / 1000;
  if (plan) {
    seconds = time;
    const p = positionAlong(plan, time), events = scheduledEventsAt(plan, time, p.s);
    const upcoming = events.upcoming.filter(event => timeline.range.contains(event) && (event.type === 'station' || event.target === (event.featureId === events.tunnel?.id ? 'exit' : 'entrance')));
    prediction = { direction: plan.train.direction, position: { s: p.s, speedKmh: p.speed, inTunnel: Boolean(events.tunnel), tunnelId: events.tunnel?.id }, upcoming, next: { station: upcoming.find(event => event.type === 'station') } };
    timeline.update(time, playing);
  } else if (selected?.activeAt(now)) {
    prediction = selected.snapshot(selected.secondsAt(now));
  }
  const overview = isMenuOpen() || !prediction;
  const visibleEvents = queue.cards(prediction);
  map.setOverview(overview, menuTransitionDuration);
  document.body.classList.toggle('overview-mode', overview);
  for (const node of document.querySelectorAll('.journey-views,.cue-overlay')) if (node.hidden !== overview) node.hidden = overview;
  document.querySelector('.journey-instruments').hidden = !prediction || (overview && !(menu?.active && menuHasTrain));
  text($('journey-status'), !overview || isMenuOpen() || route === 'home' ? '' : isPerformance ?
    selected ? '選択した列車は現在ダイヤ上の運行時間外です。' : 'スマホのGPSを待っています。列車を特定できない場合は、乗車列車を選んでください。' :
    'この列車の運行は終了しています。メニューから別の列車を選んでください。');
  const dark = !overview && Boolean(prediction?.position.inTunnel);
  const theme = dark ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  map.setDark(dark);
  if (prediction) {
    const [longitude, latitude] = profile.coordinateAt(prediction.position.s);
    Object.assign(prediction.position, { longitude, latitude });
    if (!overview) renderCards(visibleEvents);
    text($('journey-speed'), prediction.position.speedKmh.toFixed(1)); text($('journey-clock'), serviceTime(seconds, true));
  }
  const countdownEvent = visibleEvents.find(event => event.type === 'tunnel');
  if (!overview && !isCustom && countdownEvent?.etaSeconds > 0 && countdownEvent.etaSeconds <= 10) {
    selected.lastCountdownTime = Math.max(selected.lastCountdownTime, countdownEvent.t);
  }
  countdown.update(!overview && countdownEvent ? { ...countdownEvent, key: countdownEvent.id } : null);
  // Current position follows the display clock; fleet/GPS annotations below
  // can update less often without reducing the camera's motion cadence.
  map.setPrediction(prediction);
  if (frame - lastMap > 80) {
    const runs = menu?.active && menuHasTrain ? [selected ?? plan] : overview ? active : [selected ?? plan];
    const trains = runs.map(run => {
      const p = run === plan ? prediction.position : run.snapshot(run.secondsAt(now)).position;
      const [longitude, latitude] = profile.coordinateAt(p.s); return { run, longitude, latitude };
    });
    const point = !overview && measured && now - measured.timestamp < 3000 ? measured.coords : null;
    map.update(prediction, trains, point); lastMap = frame;
  }
}
try {
  const data = await Promise.all(['timetable-reference', 'railway-route', 'stations', 'map-data'].map(async name => {
    const response = await fetch(`${base}data/${name}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(); return response.json();
  }));
  [timetable, railway, stations] = data;
  stations = stations.stations;
  profile = createRailProfile(railway); fleet = new LiveTimetable(timetable, railway, stations); fleet.at(Date.now());
  gps = new LivePrediction(railway, stations);
  const mappedStations = railway.stations.map(station => ({ ...station, ...stations.find(item => item.order === station.order) }));
  map = createJourneyMap({ profile, stations: mappedStations, river: data[3].front.river,
    onSelect(run) { if (!isPerformance) menu.open('live', { trainId:run.train.id,day:serviceDayAt(Date.now()) }); else if (!phone?.viewer) selectTrain(run); } });
  menu = createModeMenu({ timetable, stations,
    onLive(train) { navigate('live', { train: train.id }); }, onCustom(selection) { navigate('custom', { train: selection.trainId, day: selection.day }); },
    onOpen(duration) {
      resumeAfterMenu = playing; playing = false; menuHasTrain = Boolean(plan || selected?.activeAt(Date.now())); menuTransitionDuration = duration;
      document.body.classList.remove('menu-returning'); document.body.classList.add('menu-open');
      document.body.classList.toggle('menu-following', menuHasTrain);
    },
    onCloseStart(duration) { menuTransitionDuration = duration; document.body.classList.remove('menu-open'); document.body.classList.add('menu-returning'); },
    onClose() { playing = resumeAfterMenu; lastFrame = undefined; menuTransitionDuration = 0; document.body.classList.remove('menu-open','menu-returning','menu-following'); } });
  const selection = { trainId: url.searchParams.get('train'), day: url.searchParams.get('day') === 'holiday' ? 'holiday' : 'weekday' };
  if (isCustom && selection.trainId) {
    try {
      plan = customPlan(timetable, railway, stations, selection);
      timeline = createStationTimeline({ container: $('custom-timeline'), plan, from: url.searchParams.get('from'), to: url.searchParams.get('to'),
        onSeek: seek, onRange: updateRange, onPlay(value) { if (value && time >= timeline.range.end) seek(timeline.range.start); playing = value; lastFrame = undefined; } });
      time = timeline.range.start; $('custom-timeline').hidden = false;
    } catch { plan = null; menu.open('custom', selection); }
  } else if (!isCustom && selection.trainId) selected = fleet.runs.find(run => run.train.id === selection.trainId);
  for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => setView(button.dataset.view);
  $('journey-menu').onclick = () => isPerformance ? phone.open() : menu.open(isCustom ? 'custom' : 'live', plan ? selection : selected ? {trainId:selected.train.id,day:serviceDayAt(Date.now())} : undefined);
  if (isPerformance) {
    const { createPerformanceLink } = await import('./performance-link.js');
    phone = createPerformanceLink({ onFix: acceptFix, onState(message) { text($('performance-status'), message); },
      onView(state) {
        if (!state || state.date !== japanDate(Date.now())) return;
        if (state.trainId === null) { selected = null; $('performance-train').value = ''; gps.reset(); queue.reset(); }
        const run = fleet.runs.find(run => run.train.id === state.trainId);
        if (run) { run.delay = state.delay; if (selected !== run) selectTrain(run, false); if (view !== state.mode) setView(state.mode, false); }
      }, onOpen() { document.body.classList.add('menu-open'); }, onClose() { document.body.classList.remove('menu-open'); map.reset(); publishView(); } });
    const picker = $('performance-train');
    picker.append(...fleet.runs.map(run => new Option(`${run.train.id} · ${directionName(run.train.direction)} ${serviceTime(run.start)}発`, run.train.id)));
    picker.disabled = phone.viewer;
    picker.onchange = () => { const run = fleet.runs.find(run => run.train.id === picker.value); if (run) selectTrain(run); else { selected = null; publishView(); } };
    document.querySelector('.performance-controls').hidden = false;
    if (phone.viewer) for (const button of document.querySelectorAll('[data-view]')) button.disabled = true;
    await phone.open();
  } else if (route === 'home' || (isCustom && !plan) || (!isCustom && !selected)) menu.open(isCustom ? 'custom' : 'live');
  $('loading').hidden = true;
  requestAnimationFrame(render);
} catch (error) {
  console.error(error);
  $('loading').querySelector('h2').textContent = '画面を読み込めませんでした';
  $('loading').querySelector('p').textContent = '通信状況を確認して再読み込みしてください。';
  $('reload-data').hidden = false;
}
