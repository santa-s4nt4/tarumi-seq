import './style.css';
import './que.css';
import './live.css';
import { createModeMenu } from './mode-menu.js';
import { createJourneyMap } from './journey-map.js';
import { createStationTimeline } from './station-timeline.js';
import { createCueCountdown } from './countdown.js';
import { CueQueue } from './cues.js';
import { createCueCards } from './cue-cards.js';
import { createRailProfile } from './rail-elevation.js';
import { LiveTimetable } from './live-timetable.js';
import { LivePrediction } from './live-prediction.js';
import { activeServices, customPlan, nearestRun, directionName, serviceLabel } from './journey.js';
import { positionAlong, scheduledEventsAt, serviceTime } from './simulation.js';
import { japanDate, serviceDayEpoch, serviceDayAt } from './timetable-reference.js';
import { mapDuration, timelineDuration } from './menu-motion.js';
import { debugClock } from './debug-clock.js';
import { createVideoMode } from './video-mode.js';
import './experience.css';

const base = import.meta.env.BASE_URL, url = new URL(location.href);
const clock = debugClock(url.searchParams);
let route = url.pathname.slice(base.length).replace(/index\.html$/, '').split('/')[0] || 'home';
let isCustom = route === 'custom', isVideo = route === 'video';
const isPerformance = import.meta.env.DEV && route === 'performance';
document.title = `${route === 'home' ? '' : route.toUpperCase() + ' | '}樽見OTO鉄道`;
document.body.className = `experience ${route}-experience`;
document.documentElement.dataset.theme = 'light';
// The loading logo from index.html stays in place, so its drawing is not restarted.
document.body.insertAdjacentHTML('afterbegin', `<main class="journey-workspace"><section class="map-panel" aria-label="樽見鉄道の路線地図">
  <div id="map"></div><div id="line-map" aria-label="全線路線図"><a class="line-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></div>
  <button id="journey-menu" aria-haspopup="dialog"></button>
  <div class="journey-views" role="group" aria-label="地図の視点" hidden>
    <button data-view="auto" aria-pressed="true">自動</button><button data-view="normal" aria-pressed="false">斜俯瞰</button><button data-view="bird" aria-pressed="false">鳥瞰</button>
  </div>
  <div id="journey-video" aria-label="車窓映像" hidden></div><div id="journey-reveal" aria-hidden="true"></div>
  <aside class="cue-overlay" aria-label="次の合図" hidden><div id="cue-list"></div></aside>
  <div class="journey-instruments" hidden><p aria-label="ダイヤからの推定速度"><strong id="journey-speed">0.0</strong><span>km/h</span></p><time id="journey-clock" aria-label="${isCustom ? '再生時刻' : '現在時刻'}"></time></div>
  <div class="journey-legend" aria-label="地図の凡例"><span><i class="river"></i>河川</span><span><i class="bridge"></i>橋梁</span><span><i class="tunnel"></i>トンネル</span></div>
  <p id="journey-status" role="status"></p>
  ${isPerformance ? '<div class="performance-controls" hidden><label>乗車列車 <select id="performance-train" aria-label="乗車列車"><option value="">GPSから自動選択</option></select></label><span id="performance-status" role="status"></span></div>' : ''}
  </section></main><div id="timeline-slot" hidden></div>
`);
const $ = id => document.getElementById(id), panel = document.querySelector('.map-panel');
const cueOverlay = panel.querySelector('.cue-overlay');
const legend = panel.querySelector('.journey-legend');
const phoneLayout = matchMedia('(max-width:760px), (pointer:coarse) and (max-width:1024px)');
let cueStation;
function fitCues() {
  if (!phoneLayout.matches || cueOverlay.hidden) return;
  const width = cueOverlay.offsetWidth, height = cueOverlay.offsetHeight;
  if (!width || !height) return;
  const marker = panel.querySelector('#line-map:not([hidden]) .is-followed, #map .current-marker:not([hidden])');
  const clearance = (marker?.offsetWidth || 52) / 2 + 6;
  const station = cueStation && panel.querySelector(`#map [data-station="${cueStation}"]`);
  const stationWidth = station ? station.offsetWidth - station.querySelector('.station-tick').offsetWidth / 2 : 0;
  const right = cueOverlay.offsetLeft + width, top = cueOverlay.offsetTop;
  // With the top-right corner fixed, either axis can clear the centred train.
  const horizontal = (right - panel.clientWidth / 2 - Math.max(clearance, stationWidth + 6)) / width;
  const vertical = (panel.clientHeight / 2 - clearance - top) / height;
  const clearTrain = top >= panel.clientHeight / 2 + clearance ? 1 : Math.max(horizontal, vertical);
  const bottom = legend.offsetHeight ? legend.offsetTop - 6 : panel.clientHeight;
  cueOverlay.style.setProperty('--cue-scale', Math.max(0, Math.min(1, clearTrain, (bottom - top) / height)));
}
const cueSizer = new ResizeObserver(fitCues);
for (const node of [panel, cueOverlay, $('line-map')]) cueSizer.observe(node);
phoneLayout.addEventListener('change', fitCues);
$('reload-data').onclick = () => location.reload();
// The timeline lies over the map, so the overlays along the bottom ride above it.
new ResizeObserver(([entry]) => document.body.style.setProperty('--timeline-height', `${entry.contentRect.height}px`)).observe($('timeline-slot'));
// The menu label slides up out of view while nothing is being operated and
// comes back down on any input. Input over the VIDEO player never reaches this
// page, so there the pointer entering the player, the player changing state
// and a strip where the hidden label was bring it back.
let labelTimer;
function showLabel() {
  document.body.classList.remove('label-idle'); clearTimeout(labelTimer);
  labelTimer = setTimeout(() => document.body.classList.add('label-idle'), 3000);
}
for (const type of ['pointerdown', 'pointermove', 'pointerover', 'keydown', 'wheel']) window.addEventListener(type, showLabel, { passive: true });
$('journey-menu').addEventListener('focus', showLabel);
showLabel();
const countdown = createCueCountdown(panel);
const queue = new CueQueue();
let profile, map, fleet, timetable, railway, stations, selected, plan, timeline, menu, phone, gps, video;
let time = 0, playing = false, resumeAfterMenu = false, view = 'auto', lastFrame, lastMap = -Infinity, measured = null;
let menuHasTrain = false, menuTransitionDuration = 0;
let selection, returnTimer, timelineMotion = 0, timelineAnimations = [];
document.addEventListener('visibilitychange', () => { if (document.hidden && isCustom) { playing = false; resumeAfterMenu = false; lastFrame = undefined; } });
const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
function tunnelTarget(target) {
  if (isCustom) return target === 'exit' ? '出口' : '入口';
  return target === 'exit' ? '終了' : '開始';
}
const renderCueCards = createCueCards($('cue-list'));
const renderCards = events => renderCueCards(events, {
  title: event => `${event.name}${event.type === 'station' ? '駅' : tunnelTarget(event.target)}まで`,
  note: event => event.arrived ? '停車中' : !isCustom && selected?.delay ? `${selected.delay}秒遅れ` : '',
});
function navigate(route, params) {
  const target = new URL(base + route + '/', location.origin);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  for (const key of ['debug', 'time']) if (url.searchParams.has(key)) target.searchParams.set(key, url.searchParams.get(key));
  configureRoute(target);
  history.pushState(null, '', target);
  menu.close();
}

async function slideTimeline(show, immediate = false) {
  const slot = $('timeline-slot'), footer = $('custom-timeline');
  const token = ++timelineMotion, from = slot.hidden ? 0 : slot.getBoundingClientRect().height;
  for (const animation of timelineAnimations) animation.cancel();
  timelineAnimations = [];
  document.body.classList.remove('timeline-moving');
  if (!footer || !plan) { slot.hidden = true; return; }
  const duration = immediate ? 0 : timelineDuration();
  if (!duration || (!show && !from)) {
    slot.hidden = !show; slot.style.height = ''; footer.style.transform = ''; slot.dataset.state = show ? 'visible' : 'hidden'; return;
  }
  slot.hidden = false; slot.dataset.state = show ? 'entering' : 'leaving';
  document.body.classList.add('timeline-moving');
  slot.style.height = `${from}px`;
  const height = footer.offsetHeight;
  const options = { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' };
  timelineAnimations = [slot.animate([{ height: `${from}px` }, { height: `${show ? height : 0}px` }], options)];
  await Promise.all(timelineAnimations.map(animation => animation.finished.catch(() => {})));
  if (token !== timelineMotion) return;
  slot.hidden = !show; slot.style.height = ''; footer.style.transform = '';
  slot.dataset.state = show ? 'visible' : 'hidden';
  for (const animation of timelineAnimations) animation.cancel();
  timelineAnimations = [];
  document.body.classList.remove('timeline-moving');
}

function configureRoute(target) {
  clearTimeout(returnTimer); resumeAfterMenu = playing = false;
  ++timelineMotion; for (const animation of timelineAnimations) animation.cancel(); timelineAnimations = [];
  timeline?.destroy(); timeline = plan = selected = null;
  video?.destroy(); video = null;
  $('timeline-slot').replaceChildren(); $('timeline-slot').hidden = true; $('timeline-slot').style.height = '';
  $('timeline-slot').dataset.state = 'hidden';
  route = target.pathname.slice(base.length).replace(/index\.html$/, '').split('/')[0] || 'home'; isCustom = route === 'custom'; isVideo = route === 'video';
  document.title = `${route === 'home' ? '' : route.toUpperCase() + ' | '}樽見OTO鉄道`;
  document.body.classList.remove('home-experience', 'live-experience', 'custom-experience', 'video-experience', 'menu-returning', 'timeline-moving');
  document.body.classList.add(`${route}-experience`);
  $('journey-clock').setAttribute('aria-label', isCustom ? '再生時刻' : '現在時刻');
  menu?.setDismissible(route !== 'home');
  selection = { trainId: target.searchParams.get('train'), day: target.searchParams.get('day') === 'holiday' ? 'holiday' : 'weekday' };
  queue.reset(); countdown.update(null); map.reset(); setView('auto', false); lastMap = -Infinity;
  if (isVideo) {
    const direction = target.searchParams.get('direction') === 'front' ? 'front' : 'back';
    video = createVideoMode({ container: $('journey-video'), base, direction, onActivity: showLabel }); menu?.setVideo(direction);
  }
  else if (isCustom && selection.trainId) {
    try {
      plan = customPlan(timetable, railway, stations, selection);
      const footer = document.createElement('footer'); footer.id = 'custom-timeline'; $('timeline-slot').append(footer);
      timeline = createStationTimeline({ container: footer, plan, from: target.searchParams.get('from'), to: target.searchParams.get('to'),
        onSeek: seek, onRange: updateRange, onPlay(value) { if (value && time >= timeline.range.end) seek(timeline.range.start); resumeAfterMenu = playing = value; lastFrame = undefined; } });
      time = timeline.range.start;
      if (target.searchParams.has('from') || target.searchParams.has('to')) {
        const currentRoute = target.href === location.href;
        target.searchParams.set('from', plan.stops[timeline.range.first].station);
        target.searchParams.set('to', plan.stops[timeline.range.last].station);
        if (currentRoute) history.replaceState(null, '', target);
      }
    } catch { plan = null; }
  } else if (selection.trainId) {
    const now = clock();
    if (isPerformance) selected = fleet.runs.find(run => run.train.id === selection.trainId);
    else if (activeServices(timetable, now).some(train => train.id === selection.trainId)) {
      selected = fleet.at(now).active.find(run => run.train.id === selection.trainId);
    }
  }
  const menuLabel = plan ? serviceLabel(plan.train, stations) : route.toUpperCase();
  text($('journey-menu'), menuLabel); $('journey-menu').setAttribute('aria-label', `${menuLabel}　メニューを開く`);
}

function startReturn() {
  menuTransitionDuration = mapDuration();
  document.body.classList.remove('menu-open', 'menu-preparing'); document.body.classList.add('menu-returning');
  clearTimeout(returnTimer);
  returnTimer = setTimeout(() => {
    playing = isCustom && resumeAfterMenu; lastFrame = undefined; video?.resume();
    document.body.classList.remove('menu-returning', 'menu-following');
  }, mapDuration());
}
function setView(mode, share = true) {
  view = mode; map.setMode(mode);
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === mode));
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
  const now = clock(), { active } = fleet.at(now);
  let prediction = null, seconds = (now - serviceDayEpoch(japanDate(now))) / 1000;
  if (plan) {
    seconds = time;
    const p = positionAlong(plan, time), events = scheduledEventsAt(plan, time, p.s);
    if (phoneLayout.matches) {
      const station = plan.stops.find(stop => Math.abs(stop.s - p.s) < 10)?.station;
      if (cueStation !== station) { cueStation = station; fitCues(); }
    }
    const upcoming = events.upcoming.filter(event => timeline.range.contains(event) && (event.type === 'station' || event.target === (event.featureId === events.tunnel?.id ? 'exit' : 'entrance')));
    prediction = { direction: plan.train.direction, position: { s: p.s, speedKmh: p.speed, inTunnel: Boolean(events.tunnel), tunnelId: events.tunnel?.id }, upcoming, next: { station: upcoming.find(event => event.type === 'station') } };
    timeline.update(time, playing);
  } else if (selected?.activeAt(now)) {
    prediction = selected.snapshot(selected.secondsAt(now));
  }
  const overview = isMenuOpen() || !prediction;
  const visibleEvents = queue.cards(prediction);
  if (prediction) {
    const [longitude, latitude] = profile.coordinateAt(prediction.position.s);
    Object.assign(prediction.position, { longitude, latitude });
  }
  map.setPrediction(prediction);
  map.setOverview(overview, menuTransitionDuration);
  document.body.classList.toggle('overview-mode', overview);
  for (const node of document.querySelectorAll('.journey-views,.cue-overlay')) if (node.hidden !== overview) node.hidden = overview;
  document.querySelector('.journey-instruments').hidden = !prediction || (overview && !(menu?.active && menuHasTrain));
  video?.render(frame);
  text($('journey-status'), !overview || isMenuOpen() || route === 'home' || isVideo ? '' : isPerformance ?
    selected ? '選択した列車は現在ダイヤ上の運行時間外です。' : 'スマホのGPSを待っています。列車を特定できない場合は、乗車列車を選んでください。' :
    'この列車の運行は終了しています。メニューから別の列車を選んでください。');
  const dark = !overview && Boolean(prediction?.position.inTunnel);
  const theme = dark ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  map.setDark(dark);
  if (prediction) {
    if (!overview) renderCards(visibleEvents);
    text($('journey-speed'), prediction.position.speedKmh.toFixed(1)); text($('journey-clock'), serviceTime(seconds, true));
  }
  const countdownEvent = visibleEvents.find(event => event.type === 'tunnel');
  if (!overview && !isCustom && countdownEvent?.etaSeconds > 0 && countdownEvent.etaSeconds <= 10) {
    selected.lastCountdownTime = Math.max(selected.lastCountdownTime, countdownEvent.t);
  }
  const transitioning = document.body.classList.contains('menu-returning') || document.body.classList.contains('menu-preparing');
  countdown.update(!overview && !transitioning && countdownEvent ? { ...countdownEvent, key: countdownEvent.id, portalLabel: tunnelTarget(countdownEvent.target) } : null);
  // Current position follows the display clock; fleet/GPS annotations below
  // can update less often without reducing the camera's motion cadence.
  if (frame - lastMap > 80) {
    const liveChoices = menu?.visibleLiveChoices;
    const showFollowed = !overview || (menu?.active && menuHasTrain);
    const runs = liveChoices ? active.filter(run => liveChoices.some(train => train.id === run.train.id))
      : showFollowed ? [selected ?? plan] : active;
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
  profile = createRailProfile(railway); fleet = new LiveTimetable(timetable, railway, stations); fleet.at(clock());
  gps = new LivePrediction(railway, stations);
  const mappedStations = railway.stations.map(station => ({ ...station, ...stations.find(item => item.order === station.order) }));
  map = createJourneyMap({ profile, stations: mappedStations, river: data[3].front.river,
    onSelect(run) { if (!isPerformance) menu.open('live', { trainId:run.train.id,day:serviceDayAt(clock()) }); else if (!phone?.viewer) selectTrain(run); } });
  menu = createModeMenu({ timetable, stations, now: clock, dismissible: route !== 'home',
    onLive(train) { navigate('live', { train: train.id }); }, onCustom(selection) { navigate('custom', { train: selection.trainId, day: selection.day }); },
    onVideo(direction) { navigate('video', { direction }); },
    async beforeOpen() {
      clearTimeout(returnTimer); resumeAfterMenu = playing; playing = false; video?.pause();
      document.body.classList.remove('menu-returning'); document.body.classList.add('menu-preparing');
      await slideTimeline(false); document.body.classList.remove('menu-preparing');
    },
    onOpen() {
      menuHasTrain = Boolean(plan || selected?.activeAt(clock())); menuTransitionDuration = mapDuration();
      document.body.classList.remove('menu-returning'); document.body.classList.add('menu-open');
      document.body.classList.toggle('menu-following', menuHasTrain);
    },
    onCloseStart: startReturn,
    onClose() { slideTimeline(Boolean(plan)); } });
  configureRoute(url);
  await slideTimeline(Boolean(plan), true);
  for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => setView(button.dataset.view);
  $('journey-menu').onclick = () => isPerformance ? phone.open() : menu.open(isVideo ? 'video' : isCustom ? 'custom' : 'live', plan ? selection : selected ? {trainId:selected.train.id,day:serviceDayAt(clock())} : undefined);
  await window.splashShown;
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
  } else if (route === 'home' || (isCustom && !plan) || (!isCustom && !isVideo && !selected)) await menu.open(isCustom ? 'custom' : 'live', selection.trainId ? selection : undefined);
  window.addEventListener('popstate', async () => {
    await slideTimeline(false);
    configureRoute(new URL(location.href));
    if (route === 'home' || (!plan && !selected && !isVideo)) await menu.open(isCustom ? 'custom' : 'live', selection.trainId ? selection : undefined);
    else if (menu.active) menu.close();
    else { startReturn(); slideTimeline(Boolean(plan)); }
  });
  $('loading').hidden = true;
  requestAnimationFrame(render);
} catch (error) {
  console.error(error);
  $('loading').querySelector('h2').textContent = '画面を読み込めませんでした';
  $('loading').querySelector('p').textContent = '通信状況を確認して再読み込みしてください。';
  $('reload-data').hidden = false;
}
