// The supplied GPS records contain speed in km/h (confirmed against coordinate displacement).
// The route projection lies between two records, so interpolate their stored readings.
export function recordedSpeedAt(nodes, match) {
  const a = nodes[match.i][4], b = nodes[match.i + 1][4];
  if (Number.isFinite(a) && Number.isFinite(b)) return a + (b - a) * match.u;
  return Number.isFinite(a) ? a : Number.isFinite(b) ? b : null;
}

import { distance, xy } from './geometry.js';

// Centred displacement over up to four seconds, independent of source speed units.
export function speedAt(nodes, index) {
  const a = nodes[Math.max(0, index - 2)], b = nodes[Math.min(nodes.length - 1, index + 2)];
  return b[3] > a[3] ? distance(a, b) / (b[3] - a[3]) : 0;
}

export function stationStop(nodes, station, match) {
  const point = xy(station.lat, station.lon);
  const runs = [];
  let start = null;
  for (let i = 0; i <= nodes.length; i++) {
    const stopped = i < nodes.length && distance(nodes[i], point) <= 100 && speedAt(nodes, i) <= 0.8;
    if (stopped && start === null) start = i;
    if (!stopped && start !== null) {
      const end = i - 1;
      if (nodes[end][3] - nodes[start][3] >= 10) runs.push({ start, end });
      start = null;
    }
  }
  // The first low-speed run is arrival; later runs near the same station can
  // be split by GPS jitter during dwell. Do not choose the run nearest the station coordinate.
  const stop = runs.length ? { start: runs[0].start, end: runs.at(-1).end } : null;
  if (!stop) return null;
  while (stop.start > 0 && distance(nodes[stop.start], nodes[stop.start - 1]) <= 0.8 * (nodes[stop.start][3] - nodes[stop.start - 1][3]) && distance(nodes[stop.start - 1], point) <= 100) stop.start--;
  while (stop.end < nodes.length - 1 && distance(nodes[stop.end], nodes[stop.end + 1]) <= 0.8 * (nodes[stop.end + 1][3] - nodes[stop.end][3]) && distance(nodes[stop.end + 1], point) <= 100) stop.end++;
  const a = nodes[stop.start], b = nodes[stop.end];
  return { s:a[2], t:a[3], departureS:b[2], departureT:b[3], arrivalMethod:'gps_stop_under_0.8mps_for_10s' };
}
