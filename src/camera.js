import { sampleAt } from './timeline.js';
import { xy, latLon, distance } from './geometry.js';

// Use a short stretch of track to avoid turning the camera with GPS jitter.
// Look through station dwell; at the route endpoint use the incoming direction.
export function routeBearing(records, time, lookahead = 30) {
  const p = sampleAt(records, time), origin = xy(p.lat, p.lon);
  let target;
  for (const r of records) {
    if (r.t <= time) continue;
    target = xy(r.lat, r.lon);
    if (distance(origin, target) >= lookahead) break;
  }
  if (target && distance(origin, target) >= 2) return bearing(origin, target);
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.t >= time) continue;
    target = xy(r.lat, r.lon);
    if (distance(origin, target) >= lookahead) break;
  }
  return target && distance(origin, target) >= 2 ? bearing(target, origin) : 0;
}

function bearing(from, to) { return Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI; }

// Check a short continuous stretch of track, rather than returning to normal
// for a small gap between two hills. Distance works at any playback speed.
export function routeLookahead(records, time, metres = 180, step = 30) {
  let previous = { ...sampleAt(records, time), t: time }, travelled = 0, next = step;
  const positions = [];
  for (const record of records) {
    if (record.t <= time) continue;
    if (record.t - previous.t > 5) break;
    const length = distance(xy(previous.lat, previous.lon), xy(record.lat, record.lon));
    while (length > 0 && next <= travelled + length && next <= metres) {
      const fraction = (next - travelled) / length;
      positions.push({ lat: previous.lat + (record.lat - previous.lat) * fraction,
        lon: previous.lon + (record.lon - previous.lon) * fraction, t: previous.t + (record.t - previous.t) * fraction });
      next += step;
    }
    travelled += length;
    previous = record;
    if (travelled >= metres) break;
  }
  if (travelled > 0 && travelled < metres) positions.push(previous);
  return positions;
}

export function turnTowards(current, target, fraction = 0.12) {
  const delta = ((target - current + 540) % 360) - 180;
  return ((current + delta * fraction + 540) % 360) - 180;
}

// Test the normal perspective even in bird view; testing the active view would
// make revealing the position immediately switch the camera back into the hill.
export function terrainClearance({ center, bearing, radius, sampleElevation, targetElevation, pitch = 72, horizontal = radius * Math.sin(pitch * Math.PI / 180), vertical = radius * Math.cos(pitch * Math.PI / 180) }) {
  const surface = sampleElevation(center.lon, center.lat);
  if (!Number.isFinite(surface)) return null;
  const elevation = Number.isFinite(targetElevation) ? targetElevation : surface;
  const origin = xy(center.lat, center.lon), radians = bearing * Math.PI / 180;
  // A rail line buried below a mountain stays occluded even when the ray from
  // its projected screen position misses the nearest terrain samples.
  let incomplete = false, clearance = Number.isFinite(targetElevation) && surface - elevation > 6 ? surface - elevation : -Infinity;
  // Mapbox fades markers when a surface at least 10% closer to the camera
  // covers them. Ignore the ground immediately beside the marker itself.
  for (let i = 5; i <= 48; i++) {
    const fraction = i / 48;
    const p = latLon([origin[0] - Math.sin(radians) * horizontal * fraction, origin[1] - Math.cos(radians) * horizontal * fraction]);
    const height = sampleElevation(p.longitude, p.latitude);
    if (!Number.isFinite(height)) { incomplete = true; continue; }
    clearance = Math.max(clearance, height - elevation - vertical * fraction);
  }
  return incomplete ? null : clearance;
}

export function terrainOccludesPosition(options) {
  const clearance = terrainClearance(options);
  return clearance === null ? null : clearance > 8;
}

export class OcclusionCamera {
  constructor({ pitch = 72, zoom = 17, birdZoom = 19, duration = 500, clearDelay = 350 } = {}) {
    this.perspective = { pitch, zoom };
    this.birdView = { pitch: 0, zoom: birdZoom };
    this.target = this.from = this.perspective;
    this.duration = duration;
    this.clearDelay = clearDelay;
    this.startedAt = 0;
    this.clearSince = null;
    this.mode = 'auto';
  }
  valueAt(now) {
    const t = Math.max(0, Math.min(1, (now - this.startedAt) / this.duration));
    const eased = t * t * (3 - 2 * t);
    return {
      pitch: this.from.pitch + (this.target.pitch - this.from.pitch) * eased,
      zoom: this.from.zoom + (this.target.zoom - this.from.zoom) * eased
    };
  }
  reset(now) {
    this.from = this.valueAt(now);
    this.target = this.mode === 'bird' ? this.birdView : this.perspective;
    this.startedAt = now;
    this.clearSince = null;
  }
  setMode(mode, now) {
    if (!['auto', 'normal', 'bird'].includes(mode)) return;
    this.from = this.valueAt(now);
    this.mode = mode;
    this.target = mode === 'bird' ? this.birdView : this.perspective;
    this.startedAt = now;
    this.clearSince = null;
  }
  setZooms(zoom, birdZoom, now) {
    const bird = this.target === this.birdView;
    this.from = this.valueAt(now);
    this.perspective = { pitch: this.perspective.pitch, zoom };
    this.birdView = { pitch: 0, zoom: birdZoom };
    this.target = bird ? this.birdView : this.perspective;
    this.startedAt = now;
    this.clearSince = null;
  }
  update(obscured, now) {
    if (this.mode !== 'auto') return this.valueAt(now);
    let target = this.target;
    if (obscured === true) { target = this.birdView; this.clearSince = null; }
    else if (obscured === false && this.target === this.birdView) {
      this.clearSince ??= now;
      if (now - this.clearSince >= this.clearDelay) target = this.perspective;
    }
    // Loading terrain is not evidence of a clear sightline. Only consecutive
    // confirmed clear samples can return to perspective.
    else if (obscured == null) {
      this.clearSince = null;
    }
    if (target !== this.target) {
      this.from = this.valueAt(now);
      this.target = target;
      this.startedAt = now;
    }
    return this.valueAt(now);
  }
}

// Compare requested camera states, not Mapbox's terrain-constrained result.
// Reapplying the requested zoom every frame fights the terrain safety clamp.
export function cameraChanges(previous, camera) {
  if (!previous) return camera;
  const changes = {};
  if (Math.abs(previous.center[0] - camera.center[0]) > 1e-9 || Math.abs(previous.center[1] - camera.center[1]) > 1e-9) changes.center = camera.center;
  for (const key of ['zoom', 'pitch', 'bearing']) if (Math.abs(previous[key] - camera[key]) > 0.0001) changes[key] = camera[key];
  return changes;
}
