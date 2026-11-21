import { terrainClearance, turnTowards } from './camera.js';
import { xy } from './geometry.js';

export const FORWARD_ZOOM = 20, BIRD_ZOOM = 19, FORWARD_PITCH = 68;
export const TERRAIN_CHECK_INTERVAL = 200;
export function cameraRadius(latitude, height, zoom) {
  return 1.5 * height * 40075016.686 * Math.cos(latitude * Math.PI / 180) / (512 * 2 ** zoom);
}
// Test the same hypothetical forward view in both modes. The visible marker's
// opacity changes with the camera and must never feed back into mode selection.
export class JourneyCamera {
  constructor() { this.mode = 'auto'; this.targetBird = false; this.bearing = null; this.changedAt = -Infinity; this.candidate = null; this.pitch = FORWARD_PITCH; this.zoom = FORWARD_ZOOM; this.lastTerrainCheck = -Infinity; this.obscured = null; }
  setMode(mode) { this.mode = mode; this.candidate = null; this.lastTerrainCheck = -Infinity; }
  reset() { this.bearing = null; this.candidate = null; this.lastTerrainCheck = -Infinity; this.obscured = null; }
  decide(obscured, now) {
    if (this.mode !== 'auto') { this.targetBird = this.mode === 'bird'; this.candidate = null; return; }
    if (obscured === null || obscured === this.targetBird) { this.candidate = null; return; }
    if (this.candidate?.value !== obscured) this.candidate = { value: obscured, since: now };
    const delay = obscured ? 600 : 3000;
    if (now - this.candidate.since >= delay && now - this.changedAt >= 2500) {
      this.targetBird = obscured; this.changedAt = now; this.candidate = null;
    }
  }
  at({ profile, s, direction, height, sampleElevation, now, elapsed = 16 }) {
    const sign = direction === 'front' ? 1 : -1;
    const center = profile.coordinateAt(s), ahead = profile.coordinateAt(s + sign * 80);
    const a = xy(center[1], center[0]), b = xy(ahead[1], ahead[0]);
    const behind = profile.coordinateAt(s - sign * 80), c = xy(behind[1], behind[0]);
    const dx = Math.hypot(b[0] - a[0], b[1] - a[1]) > 2 ? b[0] - a[0] : a[0] - c[0];
    const dy = Math.hypot(b[0] - a[0], b[1] - a[1]) > 2 ? b[1] - a[1] : a[1] - c[1];
    const heading = Math.atan2(dx, dy) * 180 / Math.PI;
    this.bearing = this.bearing === null ? heading : turnTowards(this.bearing, heading, 1 - Math.exp(-elapsed / 450));
    const elevation = profile.elevationAt(s);
    // Keep camera motion at display cadence. Terrain changes slowly enough to
    // sample independently; the same ray tests and hysteresis still apply.
    if (this.mode === 'auto' && sampleElevation && now - this.lastTerrainCheck >= TERRAIN_CHECK_INTERVAL) {
      this.lastTerrainCheck = now;
      let obscured = null;
      const radius = cameraRadius(center[1], height, FORWARD_ZOOM);
      const clearances = [0, 60, 120, 200, 300].map(offset => {
        const distance = Math.max(0, Math.min(profile.maxS, s + sign * offset));
        const point = profile.coordinateAt(distance);
        return terrainClearance({ center: { lon: point[0], lat: point[1] }, bearing: this.bearing, radius,
          pitch: FORWARD_PITCH, targetElevation: profile.elevationAt(distance), sampleElevation });
      });
      if (clearances.some(value => value !== null && value > 6)) obscured = true;
      else if (clearances.every(value => value !== null && value < -6)) obscured = false;
      this.obscured = obscured;
    }
    this.decide(this.obscured, now);
    const fraction = 1 - Math.exp(-elapsed / 240);
    const pitch = this.targetBird ? 0 : FORWARD_PITCH, zoom = this.targetBird ? BIRD_ZOOM : FORWARD_ZOOM;
    this.pitch = Math.abs(this.pitch - pitch) < 0.01 ? pitch : this.pitch + (pitch - this.pitch) * fraction;
    this.zoom = Math.abs(this.zoom - zoom) < 0.001 ? zoom : this.zoom + (zoom - this.zoom) * fraction;
    return { center, elevation, pitch: this.pitch, zoom: this.zoom, bearing: this.bearing };
  }
}
