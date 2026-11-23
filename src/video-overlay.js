// Cue overlay for VIDEO, copied from video-labeler/public/overlay.js so the
// layout and wording match the labelled export. Keep the two in step.
//
// A feature is { id, type: 'station' | 'tunnel', name, in, out }.
//   station: in = 停車, out = 発車 (in だけなら通過)
//   tunnel : in = 入口, out = 出口
// Features are kept in route order.

export const COUNTDOWN_SECONDS = 10;
const ZERO_HOLD_SECONDS = 0.18; // the old interface keeps "0" on screen this long
const UPCOMING_LIMIT = 3;
const ROUTE_STEP_METRES = 10; // the dot moves in steps far smaller than a pixel
const FONT = '"Tarumi OTO Stroke", sans-serif';
const WHITE = '#ffffff';
const isNum = Number.isFinite;
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

// ---------- cues ----------
export function cueKeys(features) {
  const keys = [];
  for (const feature of features) {
    for (const edge of ['in', 'out']) {
      if (isNum(feature[edge])) keys.push({ id: `${feature.id}:${edge}`, t: feature[edge], type: feature.type, edge, name: feature.name });
    }
  }
  return keys.sort((a, b) => a.t - b.t);
}

// Wording follows the old countdown; departure is new.
function heading(key) {
  if (key.type === 'station') return key.edge === 'in' ? `${key.name}駅まで` : `${key.name}駅 発車まで`;
  return `${key.name}${key.edge === 'in' ? '開始' : '終了'}まで`;
}

function activeCountdown(keys, t) {
  let hold = null;
  for (const key of keys) {
    // Nothing can count down to a key at the very start of the video.
    if (key.t <= 0) continue;
    const eta = key.t - t;
    if (eta > 0) return eta <= COUNTDOWN_SECONDS ? { key, eta } : hold;
    if (eta > -ZERO_HOLD_SECONDS) hold = { key, eta: 0 };
  }
  return hold;
}

// Like the old cue list: one card per spot, showing its next pending key
// (a tunnel shows its exit once inside, a station its departure once stopped).
function upcomingCards(features, t) {
  const pending = [];
  for (const feature of features) {
    const edge = isNum(feature.in) && t < feature.in ? 'in' : isNum(feature.out) && t < feature.out ? 'out' : null;
    if (edge) pending.push({ type: feature.type, edge, name: feature.name, t: feature[edge] });
  }
  return pending.sort((a, b) => a.t - b.t).slice(0, UPCOMING_LIMIT).map(key => ({
    heading: heading(key),
    seconds: Math.ceil(key.t - t).toLocaleString('ja-JP'),
  }));
}

// When the train reaches a station. A station with only a departure time is
// where the video starts, so the train is there from the beginning.
const arrival = station => (isNum(station.in) ? station.in : isNum(station.out) ? -Infinity : null);

function nextStation(features, t) {
  const stations = features.filter(feature => feature.type === 'station');
  // Stations without times count as behind us once a later station is reached.
  let reached = -1;
  stations.forEach((station, index) => { const at = arrival(station); if (at !== null && t >= at) reached = index; });
  const current = stations[reached];
  if (current && isNum(current.out) && t < current.out) return { name: current.name, stopped: true };
  const next = stations[reached + 1];
  return next ? { name: next.name, stopped: false } : null;
}

export function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

// ---------- route ----------
// routeData is public/route.json: the whole line as [lon, lat, metres] plus the
// distance of every station and tunnel, keyed by the same ids as the features.
function lonLatAt(points, s) {
  if (s <= points[0][2]) return points[0];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    if (s > b[2]) continue;
    const ratio = b[2] > a[2] ? (s - a[2]) / (b[2] - a[2]) : 0;
    return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio, s];
  }
  return points.at(-1);
}

function buildRoute(features, data) {
  if (!data) return null;
  const stations = features.filter(feature => feature.type === 'station' && data.stations[feature.id]);
  if (stations.length < 2) return null;
  const stationS = stations.map(station => data.stations[station.id].s);
  const low = Math.min(...stationS), high = Math.max(...stationS);
  const origin = stationS[0];
  const descending = stationS.at(-1) < origin;

  // Only the part of the line this trip covers, north up, in metres.
  const section = [lonLatAt(data.points, low), ...data.points.filter(point => point[2] > low && point[2] < high), lonLatAt(data.points, high)];
  const metresPerLon = 111320 * Math.cos(section.reduce((sum, point) => sum + point[1], 0) / section.length * Math.PI / 180);
  const projected = section.map(([lon, lat, s]) => [lon * metresPerLon, -lat * 110540, s]);
  const minX = Math.min(...projected.map(point => point[0])), minY = Math.min(...projected.map(point => point[1]));
  const points = projected.map(([x, y, s]) => [x - minX, y - minY, s]);

  // Every labelled key pins the train to a known place on the line.
  const anchors = [];
  for (const feature of features) {
    const place = feature.type === 'station' ? data.stations[feature.id] : data.tunnels[feature.id];
    if (!place) continue;
    const at = feature.type === 'station' ? { in: place.s, out: place.s } : descending ? { in: place.end, out: place.start } : { in: place.start, out: place.end };
    for (const edge of ['in', 'out']) if (isNum(feature[edge])) anchors.push({ t: feature[edge], s: at[edge] });
  }
  anchors.sort((a, b) => a.t - b.t);
  if (!anchors.length || anchors[0].t > 0) anchors.unshift({ t: 0, s: origin });

  return {
    points, low, high, origin, anchors, stationS,
    width: Math.max(...points.map(point => point[0])),
    height: Math.max(...points.map(point => point[1])),
  };
}

// Distance along the line at time t: straight interpolation between labelled
// keys, and past the last one the train keeps the speed of the final stretch.
function distanceAt(route, t) {
  const anchors = route.anchors;
  if (t <= anchors[0].t) return anchors[0].s;
  for (let index = 1; index < anchors.length; index++) {
    const a = anchors[index - 1], b = anchors[index];
    if (t > b.t) continue;
    return b.t > a.t ? a.s + (b.s - a.s) * (t - a.t) / (b.t - a.t) : b.s;
  }
  const last = anchors.at(-1), previous = anchors.at(-2);
  const speed = previous && last.t > previous.t ? (last.s - previous.s) / (last.t - previous.t) : 0;
  return clamp(last.s + speed * (t - last.t), route.low, route.high);
}

function pointAt(route, s) {
  const point = lonLatAt(route.points, clamp(s, route.low, route.high));
  return [point[0], point[1]];
}

// ---------- state ----------
// Everything derived from the labels once, so each frame only does lookups.
export function buildScene(features, routeData) {
  return { features, keys: cueKeys(features), route: buildRoute(features, routeData) };
}

export function overlayState(scene, t, duration) {
  const station = nextStation(scene.features, t);
  const countdown = activeCountdown(scene.keys, t);
  return {
    stationLabel: station ? (station.stopped ? '停車中' : '次の駅') : '',
    stationName: station?.name ?? '',
    timecode: `${formatClock(t)} / ${formatClock(duration)}`,
    countdown: countdown ? { heading: heading(countdown.key), eta: countdown.eta } : null,
    cards: upcomingCards(scene.features, t),
    routeS: scene.route ? Math.round(distanceAt(scene.route, t) / ROUTE_STEP_METRES) * ROUTE_STEP_METRES : null,
  };
}

// Two frames with the same key look identical, so the export reuses the image.
export const stateKey = state => JSON.stringify(state);

// ---------- drawing ----------
const digitCells = new Map();
function digitCell(ctx) {
  if (!digitCells.has(ctx.font)) digitCells.set(ctx.font, Math.max(...[...'0123456789'].map(digit => ctx.measureText(digit).width)));
  return digitCells.get(ctx.font);
}
// Canvas has no tabular-nums, so digits get equal cells to stop the clock jittering.
function fillTabularRight(ctx, text, right, y) {
  const cell = digitCell(ctx);
  const widths = [...text].map(char => (/\d/.test(char) ? cell : ctx.measureText(char).width));
  let x = right - widths.reduce((sum, width) => sum + width, 0);
  ctx.textAlign = 'center';
  [...text].forEach((char, index) => { ctx.fillText(char, x + widths[index] / 2, y); x += widths[index]; });
}

// Sets the font at the given size, shrinking it if the text would not fit.
function fitFont(ctx, text, size, maxWidth) {
  ctx.font = `400 ${size}px ${FONT}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) ctx.font = `400 ${size * maxWidth / width}px ${FONT}`;
}

// Same geometry as the old SVG dial (viewBox 360): 120 ticks, the elapsed part
// at full strength, the rest at 16%, and a hand at the leading edge. All white.
function drawDial(ctx, cx, cy, diameter, elapsed) {
  ctx.save();
  ctx.translate(cx - diameter / 2, cy - diameter / 2);
  ctx.scale(diameter / 360, diameter / 360);
  ctx.strokeStyle = WHITE;
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1.8;
  for (let index = 0; index < 120; index++) {
    ctx.save();
    ctx.translate(180, 180);
    ctx.rotate(index * 3 * Math.PI / 180);
    ctx.globalAlpha = index * 3 < elapsed * 360 ? 1 : 0.16;
    ctx.beginPath();
    ctx.moveTo(0, 16 - 180);
    ctx.lineTo(0, (index % 10 === 0 ? 40 : 31) - 180);
    ctx.stroke();
    ctx.restore();
  }
  ctx.translate(180, 180);
  ctx.rotate(elapsed * 2 * Math.PI);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 10 - 180);
  ctx.lineTo(0, 42 - 180);
  ctx.stroke();
  ctx.restore();
}

function drawCountdown(ctx, countdown, w, h, unit) {
  const diameter = 720 * unit;
  const cx = w / 2, cy = h / 2 + 40 * unit;
  const elapsed = clamp((COUNTDOWN_SECONDS - countdown.eta) / COUNTDOWN_SECONDS, 0, 1);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${56 * unit}px ${FONT}`;
  ctx.fillText(countdown.heading, cx, cy - diameter / 2 - 36 * unit);

  drawDial(ctx, cx, cy, diameter, elapsed);

  // Number and unit sit side by side, centred as a group (48% / 8% of the dial).
  const number = String(Math.ceil(countdown.eta));
  const numberSize = diameter * 0.48, unitSize = diameter * 0.08, gap = diameter * 0.02;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `400 ${numberSize}px ${FONT}`;
  ctx.letterSpacing = `${-0.04 * numberSize}px`;
  const numberWidth = ctx.measureText(number).width;
  ctx.letterSpacing = '0px';
  ctx.font = `400 ${unitSize}px ${FONT}`;
  const unitWidth = ctx.measureText('秒').width;
  const left = cx - (numberWidth + gap + unitWidth) / 2;
  ctx.fillText('秒', left + numberWidth + gap, cy + diameter * 0.12);
  ctx.font = `400 ${numberSize}px ${FONT}`;
  ctx.letterSpacing = `${-0.04 * numberSize}px`;
  ctx.fillText(number, left, cy);
  ctx.letterSpacing = '0px';
}

// Sizes in 1080p pixels. The first card is the large "primary" one, as in the old list.
const CARD = {
  primary: { pad: 32, heading: 34, headingGap: 30, number: 112, unit: 24 },
  other: { pad: 26, heading: 24, headingGap: 22, number: 52, unit: 18 },
};
const CARD_WIDTH = 340;

function rule(ctx, left, right, y, unit) {
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillRect(left, y - unit, right - left, 2 * unit);
  ctx.restore();
}

// Upcoming spots stacked down the right edge: white text, no panels, thin rules between.
function drawCards(ctx, cards, w, unit, top) {
  const right = w - 56 * unit, left = right - CARD_WIDTH * unit;
  let y = top;
  cards.forEach((card, index) => {
    const size = index === 0 ? CARD.primary : CARD.other;
    rule(ctx, left, right, y, unit);
    y += size.pad * unit;

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    fitFont(ctx, card.heading, size.heading * unit, right - left);
    ctx.fillText(card.heading, left, y + size.heading * unit);
    y += (size.heading + size.headingGap) * unit;

    // Digits are about 0.74em tall, so that is the height of the number row.
    const rowHeight = size.number * 0.74 * unit, baseline = y + rowHeight;
    ctx.font = `400 ${size.unit * unit}px ${FONT}`;
    const unitWidth = ctx.measureText('秒').width;
    fitFont(ctx, card.seconds, size.number * unit, right - left - unitWidth - 6 * unit);
    ctx.fillText(card.seconds, left, baseline);
    const numberWidth = ctx.measureText(card.seconds).width;
    ctx.font = `400 ${size.unit * unit}px ${FONT}`;
    ctx.fillText('秒', left + numberWidth + 6 * unit, baseline);
    y += rowHeight + size.pad * unit;
  });
  if (cards.length) rule(ctx, left, right, y, unit);
}

const ROUTE_HEIGHT = 400;

// Mini map in the bottom-left corner: the line for this trip, the part already
// travelled at full strength, stations as small dots and a circle on the train.
function drawRoute(ctx, route, s, h, unit) {
  const scale = ROUTE_HEIGHT * unit / route.height;
  const left = 56 * unit + 20 * unit, top = h - 56 * unit - ROUTE_HEIGHT * unit;
  const place = ([x, y]) => [left + x * scale, top + y * scale];
  const trace = (from, to) => {
    const low = Math.min(from, to), high = Math.max(from, to);
    const line = [pointAt(route, low), ...route.points.filter(point => point[2] > low && point[2] < high), pointAt(route, high)].map(place);
    ctx.beginPath();
    line.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };

  ctx.save();
  ctx.strokeStyle = WHITE;
  ctx.fillStyle = WHITE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * unit;
  ctx.globalAlpha = 0.4;
  trace(route.low, route.high);
  ctx.globalAlpha = 1;
  trace(route.origin, s);

  for (const stationS of route.stationS) {
    const [x, y] = place(pointAt(route, stationS));
    ctx.beginPath();
    ctx.arc(x, y, 5 * unit, 0, 2 * Math.PI);
    ctx.fill();
  }

  const [x, y] = place(pointAt(route, s));
  ctx.beginPath();
  ctx.arc(x, y, 11 * unit, 0, 2 * Math.PI);
  ctx.fill();
  ctx.lineWidth = 2 * unit;
  ctx.beginPath();
  ctx.arc(x, y, 19 * unit, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

// Draws one overlay frame: transparent background, white only.
export function drawOverlay(ctx, state, w, h, scene) {
  ctx.clearRect(0, 0, w, h);
  const unit = h / 1080;
  const margin = 56 * unit;
  ctx.save();
  ctx.fillStyle = WHITE;
  ctx.globalAlpha = 1;

  if (state.stationName) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `400 ${32 * unit}px ${FONT}`;
    ctx.fillText(state.stationLabel, margin, margin + 30 * unit);
    ctx.font = `400 ${84 * unit}px ${FONT}`;
    ctx.fillText(state.stationName, margin, margin + 122 * unit);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${44 * unit}px ${FONT}`;
  fillTabularRight(ctx, state.timecode, w - margin, h - margin);

  drawCards(ctx, state.cards, w, unit, margin);
  if (scene.route && state.routeS !== null) drawRoute(ctx, scene.route, state.routeS, h, unit);
  if (state.countdown) drawCountdown(ctx, state.countdown, w, h, unit);
  ctx.restore();
}
