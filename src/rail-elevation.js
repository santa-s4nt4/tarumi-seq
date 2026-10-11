import { xy, latLon } from './geometry.js';

// These elevations are a visual railway grade: surveyed station ground heights
// plus a small clearance, joined in route distance. They deliberately do not
// sample the mountain surface between stations or inside tunnels.
export function railElevationAt(railway, distanceMeters) {
  const anchors = railway.elevationAnchors;
  if (!anchors?.length) throw new Error('線路の標高データを読み込めません');
  const s = Number.isFinite(distanceMeters) ? distanceMeters : 0;
  if (s <= anchors[0].s) return anchors[0].meters;
  if (s >= anchors.at(-1).s) return anchors.at(-1).meters;
  let lo = 0, hi = anchors.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].s <= s) lo = mid; else hi = mid;
  }
  const a = anchors[lo], b = anchors[hi];
  return a.meters + (b.meters - a.meters) * (s - a.s) / (b.s - a.s);
}

export function createRailProfile(railway) {
  if (!railway?.coordinates?.length || !railway.elevationAnchors?.length) throw new Error('線路データを読み込めません');
  let s = 0;
  const track = [];
  for (const [lon, lat] of railway.coordinates) {
    const [x, y] = xy(lat, lon);
    if (track.length) s += Math.hypot(x - track.at(-1).x, y - track.at(-1).y);
    track.push({ lon, lat, x, y, s });
  }
  const maxS = track.at(-1).s;
  function segmentAt(distanceMeters) {
    const target = Math.max(0, Math.min(maxS, distanceMeters));
    let lo = 0, hi = track.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (track[mid].s <= target) lo = mid; else hi = mid;
    }
    return lo;
  }
  function coordinateAt(distanceMeters) {
    const index = segmentAt(distanceMeters), a = track[index], b = track[index + 1];
    const u = Math.max(0, Math.min(1, (distanceMeters - a.s) / (b.s - a.s)));
    return [a.lon + (b.lon - a.lon) * u, a.lat + (b.lat - a.lat) * u];
  }
  function projectXY(x, y, hintS = null) {
    function scan(first, last) {
      let best = null;
      for (let i = first; i <= last; i++) {
        const a = track[i], b = track[i + 1], dx = b.x - a.x, dy = b.y - a.y;
        const length2 = dx * dx + dy * dy;
        if (length2 < 1e-10) continue;
        const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length2));
        const px = a.x + u * dx, py = a.y + u * dy, offsetMeters = Math.hypot(x - px, y - py);
        if (!best || offsetMeters < best.offsetMeters) best = { s: a.s + u * (b.s - a.s), offsetMeters, point: [px, py] };
      }
      return best;
    }
    let nearest = null;
    if (Number.isFinite(hintS)) {
      const first = segmentAt(hintS - 600), last = segmentAt(hintS + 600);
      nearest = scan(first, Math.min(track.length - 2, last + 1));
    }
    // A seek can jump outside the local window. Recheck the full line then.
    if (!nearest || nearest.offsetMeters > 100) nearest = scan(0, track.length - 2);
    const location = latLon(nearest.point);
    return { s: nearest.s, offsetMeters: nearest.offsetMeters,
      longitude: location.longitude, latitude: location.latitude,
      elevationMeters: railElevationAt(railway, nearest.s) };
  }
  function project(lon, lat, hintS = null) {
    const [x, y] = xy(lat, lon);
    return projectXY(x, y, hintS);
  }
  function section(startS, endS) {
    const reverse = endS < startS, low = Math.max(0, Math.min(startS, endS)), high = Math.min(maxS, Math.max(startS, endS));
    const coordinates = [coordinateAt(low)];
    for (const point of track) if (point.s > low && point.s < high) coordinates.push([point.lon, point.lat]);
    coordinates.push(coordinateAt(high));
    return reverse ? coordinates.reverse() : coordinates;
  }
  return { railway, track, maxS, coordinateAt, project, projectXY, section,
    elevationAt: distanceMeters => railElevationAt(railway, distanceMeters) };
}

// Mapbox's at-interpolated expression indexes this array by line-progress, so
// values must be sampled at equal distances along the GeoJSON LineString.
export function elevatedLineFeature(profile, coordinates, sampleSpacingMeters = 80) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  let length = 0;
  const nodes = [];
  for (const [lon, lat] of coordinates) {
    const [x, y] = xy(lat, lon);
    if (nodes.length) length += Math.hypot(x - nodes.at(-1).x, y - nodes.at(-1).y);
    nodes.push({ x, y, length });
  }
  if (length < 0.01) return null;
  const count = Math.max(2, Math.min(1000, Math.ceil(length / Math.max(10, sampleSpacingMeters)) + 1));
  const elevation = [];
  let segment = 0, hintS = null;
  for (let i = 0; i < count; i++) {
    const target = length * i / (count - 1);
    while (segment < nodes.length - 2 && nodes[segment + 1].length < target) segment++;
    const a = nodes[segment], b = nodes[segment + 1];
    const u = b.length > a.length ? (target - a.length) / (b.length - a.length) : 0;
    const projected = profile.projectXY(a.x + u * (b.x - a.x), a.y + u * (b.y - a.y), hintS);
    hintS = projected.s;
    elevation.push(Math.round(projected.elevationMeters * 10) / 10);
  }
  return { type: 'Feature', properties: { elevation }, geometry: { type: 'LineString', coordinates } };
}

// Layout expression for a GeoJSON line source created with lineMetrics: true.
export const railLineZOffset = ['at-interpolated',
  ['*', ['line-progress'], ['-', ['length', ['get', 'elevation']], 1]],
  ['get', 'elevation']];
