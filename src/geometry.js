// Local equirectangular projection, metres; suitable for this ~20 km dataset.
const R = 6371008.8;
const DEG = Math.PI / 180;
const COS = Math.cos(35.57 * DEG);
export const xy = (lat, lon) => [(lon - 136.64) * DEG * R * COS, (lat - 35.57) * DEG * R];
export const latLon = ([x, y]) => ({ latitude: y / (DEG * R) + 35.57, longitude: x / (DEG * R * COS) + 136.64 });
export const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const lerp = (a, b, u) => a + (b - a) * u;

// Nodes: [x, y, cumulative metres, source elapsed seconds].
export function matchRoute(nodes, point) {
  let best = null;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i], b = nodes[i + 1];
    const v = sub(b, a), length2 = v[0] ** 2 + v[1] ** 2;
    if (length2 < 1e-10) continue;
    const u = Math.max(0, Math.min(1, ((point[0] - a[0]) * v[0] + (point[1] - a[1]) * v[1]) / length2));
    const p = [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
    const offset = distance(p, point);
    if (!best || offset < best.offset) best = { point: p, offset, s: lerp(a[2], b[2], u), t: lerp(a[3], b[3], u), i, u };
  }
  return best;
}

export function pointAt(nodes, s) {
  if (s <= nodes[0][2]) return nodes[0].slice(0, 2);
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i];
    if (b[2] >= s && b[2] > a[2]) {
      const u = (s - a[2]) / (b[2] - a[2]);
      return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
    }
  }
  return nodes.at(-1).slice(0, 2);
}

// Infinite line p + t*d intersecting finite segment a..b.
export function lineIntersection(p, d, a, b) {
  const v = sub(b, a), denominator = cross(d, v);
  if (Math.abs(denominator) < 1e-9) return null; // parallel / collinear: no unique crossing
  const w = sub(a, p);
  const t = cross(w, v) / denominator, u = cross(w, d) / denominator;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, point: [p[0] + t * d[0], p[1] + t * d[1]] };
}

export function riverNormal(nodes, river, match) {
  // 40 m chord reduces sensitivity to individual GPS samples and stopping jitter.
  const tangent = sub(pointAt(nodes, match.s + 20), pointAt(nodes, match.s - 20));
  const length = Math.hypot(...tangent);
  if (length < 0.01) return { status: 'direction_unavailable', distanceMeters: null, signedDistanceMeters: null };
  const normal = [-tangent[1] / length, tangent[0] / length];
  let best = null;
  for (let i = 1; i < river.length; i++) {
    const hit = lineIntersection(match.point, normal, river[i - 1], river[i]);
    if (hit && (!best || Math.abs(hit.t) < Math.abs(best.t))) best = hit;
  }
  if (!best) return { status: 'no_intersection', distanceMeters: null, signedDistanceMeters: null };
  const d = Math.abs(best.t), east = best.point[0] - match.point[0];
  const sign = d < 0.01 ? 0 : Math.abs(east) < 0.01 ? null : Math.sign(east);
  return {
    status: sign === null ? 'east_west_undefined' : 'ok',
    distanceMeters: round(d), signedDistanceMeters: sign === null ? null : round(d * sign),
    side: sign === null ? null : sign > 0 ? 'east' : sign < 0 ? 'west' : 'on_river',
    intersection: latLon(best.point), origin: latLon(match.point),
    method: 'nearest_intersection_of_route_normal_and_river_polyline',
  };
}
export const round = n => Math.round(n * 10) / 10;
