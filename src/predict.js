import { recordedSpeedAt } from './motion.js';
import { xy, matchRoute, riverNormal, latLon, round } from './geometry.js';

export function predict(dataset, input) {
  const match = matchRoute(dataset.nodes, xy(input.latitude, input.longitude));
  if (!match || match.offset > 100) return null;
  const speedKmh = recordedSpeedAt(dataset.nodes, match);
  const currentTunnel = dataset.tunnels.find(t => match.s >= t.start && match.s < t.end);
  const upcoming = dataset.events.filter(e => (e.departureS ?? e.s) >= match.s - 0.01).map(e => ({
    id: e.id, featureId: e.featureId, type: e.type, name: e.name, target: e.target,
    distanceMeters: round(Math.max(0, e.s - match.s)),
    etaSeconds: e.target === 'arrival' && match.s >= e.s - 0.01 ? 0 : round(Math.max(0, e.t - match.t)),
    location: e.location,
    departureEtaSeconds: e.departureT === undefined ? null : round(Math.max(0, e.departureT - match.t)),
    departureDistanceMeters: e.departureS === undefined ? null : round(Math.max(0, e.departureS - match.s)),
    arrived: e.target === 'arrival' && match.s >= e.s - 0.01,
  }));
  return {
    demo: false, source: 'd1', direction: dataset.direction,
    position: {
      ...latLon(match.point), distanceAlongRouteMeters: round(match.s),
      matchOffsetMeters: round(match.offset), referenceTimeSeconds: round(match.t),
      speedMetersPerSecond: speedKmh === null ? null : round(speedKmh / 3.6),
      speedKmh: speedKmh === null ? null : round(speedKmh), speedSource: 'gps_record_speed',
      inTunnel: Boolean(currentTunnel), tunnelId: currentTunnel?.id ?? null,
    },
    upcoming,
    next: Object.fromEntries(['station','tunnel','river'].map(type => [type, upcoming.find(e => e.type === type) ?? null])),
    river: { name: '根尾川', ...riverNormal(dataset.nodes, dataset.river, match), etaSeconds: null },
    prediction: {
      method: 'recorded_trip_time_difference', estimated: true,
      basedAt: input.recordedAt ?? null, generatedAt: new Date().toISOString(),
      limitations: ['GPS-derived geometry', 'Station arrival is estimated from GPS stops; station_point is fallback', 'Single GPS cannot distinguish elapsed dwell time', 'River lateral distance has no arrival time'],
    },
    coverage: dataset.coverage, excludedFeatures: dataset.excluded, attribution: dataset.attribution,
  };
}

// Cache only immutable imported reference data, never user locations.
const caches = new WeakMap();
export async function loadDataset(db, direction) {
  let cache = caches.get(db);
  if (!cache) { cache = new Map(); caches.set(db, cache); }
  const entry = cache.get(direction);
  if (entry && Date.now() - entry.loadedAt < 60000) return entry.value;
  const { results } = await db.prepare('SELECT part, version, payload FROM route_dataset_chunks WHERE direction = ? ORDER BY part').bind(direction).all();
  if (!results.length || results.some((r,i) => r.part !== i || r.version !== results[0].version)) throw new Error('Dataset missing or mixed versions');
  const value = { ...JSON.parse(results.map(r => r.payload).join('')), version: results[0].version };
  cache.set(direction, { value, loadedAt: Date.now() });
  return value;
}
