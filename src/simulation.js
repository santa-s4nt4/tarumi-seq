import { xy, latLon, distance, pointAt, riverNormal } from './geometry.js';
import { buildRoute } from './interpolate.js';

export function serviceSeconds(value) {
  if (!/^\d{2}:\d{2}$/.test(value ?? '')) throw new Error('発車時刻の形式が不正です');
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) throw new Error('発車時刻が不正です');
  return hours * 3600 + minutes * 60;
}
export function serviceTime(seconds, includeSeconds = false) {
  const t = Math.max(0, Math.floor(seconds));
  return [Math.floor(t / 3600), Math.floor(t / 60) % 60, ...(includeSeconds ? [t % 60] : [])].map(n => String(n).padStart(2, '0')).join(':');
}
export function departures(timetable, direction, day, station) {
  return timetable.trains.filter(train => train.direction === direction && (train.operatingDays === 'daily' || day === 'holiday'))
    .flatMap(train => {
      const index = train.stops.findIndex(stop => stop.station === station && stop.departure);
      return index >= 0 && index < train.stops.length - 1 ? [{ train, time: train.stops[index].departure }] : [];
    }).sort((a, b) => serviceSeconds(a.time) - serviceSeconds(b.time));
}

// The timetable gives departure minutes, with arrival minutes at Motosu and
// termini. Other arrival times are estimates; published minutes stay exact.
export function scheduleStops(timetable, trainId, stationOrder, day = 'weekday') {
  const train = timetable.trains.find(train => train.id === trainId);
  if (!train || (train.operatingDays === 'holiday' && day !== 'holiday')) throw new Error('この運行日には選択した列車がありません');
  let calls = train.stops.map(stop => ({ ...stop }));
  const startIndex = train.stops.findIndex(stop => stop.station === stationOrder && stop.departure);
  if (startIndex < 0 || startIndex >= train.stops.length - 1) throw new Error('この駅から発車する列車を選択してください');
  calls = calls.slice(startIndex);
  const stops = calls.map((call, index) => {
    const departure = call.departure ? serviceSeconds(call.departure) : null;
    const arrival = index === 0 ? departure : call.arrival ? serviceSeconds(call.arrival) : departure - 30;
    return { ...call, arrivalSeconds: arrival, departureSeconds: departure, estimatedArrival: index > 0 && !call.arrival };
  });
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].arrivalSeconds <= stops[i - 1].departureSeconds || (stops[i].departureSeconds !== null && stops[i].departureSeconds < stops[i].arrivalSeconds)) throw new Error('駅の発着時刻が前後しています');
  }
  return { train, stops, start: stops[0].departureSeconds, end: stops.at(-1).arrivalSeconds };
}

// A short acceleration/braking ramp, then constant cruise. Unlike a cosine
// over the whole leg, this avoids implausibly high peak speed on short runs.
const ramp = 0.1;
function progress(u) {
  u = Math.max(0, Math.min(1, u));
  if (u < ramp) return { fraction: u * u / (2 * ramp * (1 - ramp)), velocity: u / (ramp * (1 - ramp)) };
  if (u > 1 - ramp) return { fraction: 1 - (1 - u) ** 2 / (2 * ramp * (1 - ramp)), velocity: (1 - u) / (ramp * (1 - ramp)) };
  return { fraction: (u - ramp / 2) / (1 - ramp), velocity: 1 / (1 - ramp) };
}
function inverseProgress(fraction) {
  const edge = ramp / (2 * (1 - ramp));
  if (fraction < edge) return Math.sqrt(fraction * 2 * ramp * (1 - ramp));
  if (fraction > 1 - edge) return 1 - Math.sqrt((1 - fraction) * 2 * ramp * (1 - ramp));
  return fraction * (1 - ramp) + ramp / 2;
}
function positionAlong(simulation, time) {
  const { stops } = simulation;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (time <= a.departureSeconds) return { s: a.s, speed: 0 };
    if (time < b.arrivalSeconds) {
      const duration = b.arrivalSeconds - a.departureSeconds;
      const value = progress((time - a.departureSeconds) / duration);
      return { s: a.s + (b.s - a.s) * value.fraction, speed: Math.abs(b.s - a.s) / duration * value.velocity * 3.6 };
    }
  }
  return { s: stops.at(-1).s, speed: 0 };
}
function timeAtDistance(simulation, s) {
  for (let i = 0; i < simulation.stops.length - 1; i++) {
    const a = simulation.stops[i], b = simulation.stops[i + 1];
    if (s >= Math.min(a.s, b.s) && s <= Math.max(a.s, b.s)) {
      const fraction = (s - a.s) / (b.s - a.s);
      return a.departureSeconds + inverseProgress(fraction) * (b.arrivalSeconds - a.departureSeconds);
    }
  }
  return null;
}
export function buildSimulation(timetable, railway, stations, selection, river = []) {
  const plan = scheduleStops(timetable, selection.trainId, selection.stationOrder, selection.day);
  let cumulative = 0;
  const ground = railway.coordinates.map(([lon, lat], index, all) => {
    const p = xy(lat, lon);
    if (index) cumulative += distance(xy(all[index - 1][1], all[index - 1][0]), p);
    return [...p, cumulative];
  });
  const stops = plan.stops.map(stop => {
    const track = railway.stations.find(s => s.order === stop.station), station = stations.find(s => s.order === stop.station);
    if (!track || !station) throw new Error('駅の位置を読み込めません');
    return { ...stop, ...track, name: station.name };
  });
  const simulation = { ...plan, stops, ground, selection, originS: stops[0].s };
  const records = [];
  for (let t = plan.start; t <= plan.end; t++) {
    const p = positionAlong(simulation, t), location = latLon(pointAt(ground, p.s));
    records.push({ t, lat: location.latitude, lon: location.longitude, speed: p.speed });
  }
  simulation.recording = { records, meta: { start_time: '2024-04-08T00:00:00+09:00', offset: 0 } };
  simulation.nodes = buildRoute(records);
  const locationAt = s => latLon(pointAt(ground, s));
  const events = stops.map((stop, index) => ({ id: `station-${stop.station}`, type: 'station', name: stop.name, target: 'arrival',
    t: stop.arrivalSeconds, departureT: stop.departureSeconds, s: Math.abs(stop.s - stops[0].s), globalS: stop.s,
    location: locationAt(stop.s), terminal: index === stops.length - 1 }));
  const tunnels = [];
  const startS = Math.min(stops[0].s, stops.at(-1).s), endS = Math.max(stops[0].s, stops.at(-1).s);
  for (const tunnel of railway.tunnels.filter(tunnel => tunnel.start >= startS && tunnel.end <= endS)) {
    const [entry, exit] = plan.train.direction === 'front' ? [tunnel.start, tunnel.end] : [tunnel.end, tunnel.start];
    const times = [timeAtDistance(simulation, entry), timeAtDistance(simulation, exit)];
    if (times.some(t => t === null)) continue;
    tunnels.push({ ...tunnel, entryT: times[0], exitT: times[1] });
    for (const [index, target] of ['entrance', 'exit'].entries()) {
      const s = index === 0 ? entry : exit;
      events.push({ id: `${tunnel.id}-${target}`, featureId: tunnel.id, type: 'tunnel', name: tunnel.name, target,
        t: times[index], s: Math.abs(s - stops[0].s), globalS: s, location: locationAt(s) });
    }
  }
  events.sort((a, b) => a.t - b.t);
  simulation.tunnels = tunnels;
  simulation.data = { events, tunnels, river: river.map(p => { const ll = latLon(p); return [ll.longitude, ll.latitude]; }), profile: [],
    version: `timetable-${timetable.revision}`, coverage: { start: locationAt(stops[0].s), end: locationAt(stops.at(-1).s), distanceMeters: Math.abs(stops.at(-1).s - stops[0].s) } };
  return simulation;
}
export function simulationPrediction(simulation, time, river) {
  const p = positionAlong(simulation, time), location = latLon(pointAt(simulation.ground, p.s));
  const upcoming = simulation.data.events.filter(event => event.type === 'station' ? event.terminal || time < event.departureT : event.t >= time)
    .map(event => ({ ...event, etaSeconds: Math.max(0, event.t - time), distanceMeters: Math.abs(event.globalS - p.s),
      arrived: event.type === 'station' && time >= event.t, departureEtaSeconds: event.departureT === null ? null : Math.max(0, event.departureT - time) }));
  const tunnel = simulation.tunnels.find(tunnel => time >= tunnel.entryT && time < tunnel.exitT);
  const index = Math.min(simulation.nodes.length - 1, Math.max(0, Math.floor(time - simulation.start)));
  const node = simulation.nodes[index], next = simulation.nodes[Math.min(simulation.nodes.length - 1, index + 1)];
  const s = node[2] + (next[2] - node[2]) * (time - Math.floor(time));
  return { source: 'timetable_simulation', direction: simulation.train.direction, datasetVersion: simulation.data.version,
    position: { ...location, distanceAlongRouteMeters: s, matchOffsetMeters: 0, speedKmh: p.speed, speedSource: 'estimated_timetable_speed', inTunnel: Boolean(tunnel), tunnelId: tunnel?.id ?? null },
    upcoming, next: Object.fromEntries(['station', 'tunnel', 'river'].map(type => [type, upcoming.find(e => e.type === type) ?? null])),
    river: { name: '根尾川', ...riverNormal(simulation.nodes, river, { point: xy(location.latitude, location.longitude), s }) } };
}
