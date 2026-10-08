import { xy, distance, riverNormal } from './geometry.js';

export function buildRoute(records) {
  let s = 0;
  return records.map((r, i) => {
    const p = xy(r.lat, r.lon);
    if (i) s += distance(xy(records[i - 1].lat, records[i - 1].lon), p);
    return [...p, s, r.t, Number.isFinite(r.speed) && r.speed >= 0 ? r.speed : null];
  });
}

function routeAt(nodes, t) {
  let lo = 0, hi = nodes.length - 1;
  if (t <= nodes[lo][3]) return nodes[lo];
  if (t >= nodes[hi][3]) return nodes[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid][3] <= t) lo = mid; else hi = mid;
  }
  const a = nodes[lo], b = nodes[hi], u = (t - a[3]) / (b[3] - a[3]);
  return a.map((n, i) => n + (b[i] - n) * u);
}

// API results stay immutable. Advance their event times using the playback clock,
// and their along-route distances using the GPS geometry, never unknown speed units.
export function interpolatePrediction(response, responseT, time, nodes, river, matchingDataset) {
  if (!response || !Number.isFinite(responseT)) return null;
  const elapsed = Math.max(0, time - responseT);
  if (elapsed < 0.001) return response;
  const start = routeAt(nodes, responseT), current = routeAt(nodes, time);
  const travelled = Math.max(0, current[2] - start[2]);
  const upcoming = response.upcoming.filter(e => e.target === 'arrival' && Number.isFinite(e.departureDistanceMeters) ? e.departureDistanceMeters + 0.01 >= travelled : !Number.isFinite(e.etaSeconds) || e.etaSeconds + 0.001 >= elapsed)
    .map(e => ({ ...e, arrived: e.target === 'arrival' && travelled >= e.distanceMeters, etaSeconds: Number.isFinite(e.etaSeconds) ? Math.max(0, e.etaSeconds - elapsed) : null,
      distanceMeters: Number.isFinite(e.distanceMeters) ? Math.max(0, e.distanceMeters - travelled) : null }));
  let tunnelId = response.position.tunnelId;
  for (const event of response.upcoming.filter(e => e.type === 'tunnel' && Number.isFinite(e.etaSeconds) && e.etaSeconds <= elapsed)) {
    tunnelId = event.target === 'entrance' ? event.featureId : null;
  }
  const lateral = matchingDataset ? riverNormal(nodes, river, { point: current.slice(0, 2), s: current[2] }) : null;
  const estimatedRiver = lateral ? { ...response.river, ...lateral, intersection: lateral.intersection ?? null, origin: lateral.origin ?? null, side: lateral.side ?? null } : response.river;
  const speed = Number.isFinite(current[4]) ? current[4] : null;
  return { ...response, upcoming, next: Object.fromEntries(['station', 'tunnel', 'river'].map(type => [type, upcoming.find(e => e.type === type) ?? null])),
    position: { ...response.position, speedMetersPerSecond: speed === null ? null : speed / 3.6, speedKmh: speed, speedSource: 'gps_record_speed', inTunnel: Boolean(tunnelId), tunnelId }, river: estimatedRiver,
    viewerPrediction: { elapsedSeconds: elapsed, riverEstimated: matchingDataset } };
}
