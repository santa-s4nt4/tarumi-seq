import { terrainClearance, turnTowards } from './camera.js';
import { xy } from './geometry.js';

export const FORWARD_ZOOM = 20, BIRD_ZOOM = 19, FORWARD_PITCH = 68;
export const TERRAIN_CHECK_INTERVAL = 200;
export function cameraRadius(latitude, height, zoom) {
  return 1.5 * height * 40075016.686 * Math.cos(latitude * Math.PI / 180) / (512 * 2 ** zoom);
}
// Match the Mercator orbit used by the map, so clearance is checked at the
// actual camera position rather than only along the ray towards the train.
export function cameraEye({ center, elevation, pitch, bearing }, radius) {
  const radians = Math.PI / 180, unit = 1 / (40075016.686 * Math.cos(center[1] * radians));
  const horizontal = radius * Math.sin(pitch * radians);
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + center[1] * radians / 2)) / Math.PI) / 2 + Math.cos(bearing * radians) * horizontal * unit;
  return { longitude: center[0] - Math.sin(bearing * radians) * horizontal * unit * 360,
    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / radians,
    altitude: elevation + 1 + radius * Math.cos(pitch * radians) };
}
export function terrainSafeRadius(view, nominal, sampleElevation, initial = nominal) {
  let radius = Math.max(nominal, initial);
  const vertical = Math.cos(view.pitch * Math.PI / 180);
  const clearance = Math.max(20, nominal * vertical * 0.6);
  for (let i = 0; i < 16; i++) {
    const eye = cameraEye(view, radius), ground = sampleElevation(eye.longitude, eye.latitude);
    if (!Number.isFinite(ground) || eye.altitude >= ground + clearance - 0.01) break;
    radius += (ground + clearance - eye.altitude) / vertical;
  }
  return radius;
}
// Test the same hypothetical forward view in both modes. The visible marker's
// opacity changes with the camera and must never feed back into mode selection.
export class JourneyCamera {
  constructor() { this.mode = 'auto'; this.targetBird = false; this.bearing = null; this.changedAt = -Infinity; this.candidate = null; this.pitch = FORWARD_PITCH; this.zoom = FORWARD_ZOOM; this.lastTerrainCheck = -Infinity; this.obscured = null; this.lastSafetyCheck = -Infinity; this.radius = null; this.requiredRadius = 0; }
  setMode(mode) { this.mode = mode; this.candidate = null; this.lastTerrainCheck = this.lastSafetyCheck = -Infinity; }
  reset() { this.bearing = null; this.candidate = null; this.lastTerrainCheck = this.lastSafetyCheck = -Infinity; this.obscured = null; this.radius = null; this.requiredRadius = 0; }
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
      const nearTunnel = profile.railway.tunnels.some(tunnel => s >= tunnel.start - (sign > 0 ? 300 : 100) && s <= tunnel.end + (sign > 0 ? 100 : 300));
      if (nearTunnel || clearances.some(value => value !== null && value > 6)) obscured = true;
      else if (clearances.every(value => value !== null && value < -6)) obscured = false;
      this.obscured = obscured;
    }
    this.decide(this.obscured, now);
    const fraction = 1 - Math.exp(-elapsed / 240);
    const pitch = this.targetBird ? 0 : FORWARD_PITCH, zoom = this.targetBird ? BIRD_ZOOM : FORWARD_ZOOM;
    this.pitch = Math.abs(this.pitch - pitch) < 0.01 ? pitch : this.pitch + (pitch - this.pitch) * fraction;
    this.zoom = Math.abs(this.zoom - zoom) < 0.001 ? zoom : this.zoom + (zoom - this.zoom) * fraction;
    const view = { center, elevation, pitch: this.pitch, zoom: this.zoom, bearing: this.bearing };
    const nominal = cameraRadius(center[1], height, view.zoom);
    if (sampleElevation) {
      // Anticipate a rising slope, then ease back after it. This also protects
      // manually selected views and the intermediate poses during transitions.
      if (now - this.lastSafetyCheck >= TERRAIN_CHECK_INTERVAL) {
        this.lastSafetyCheck = now;
        this.requiredRadius = Math.max(...[0, 80, 160, 240].map(offset => {
          const distance = Math.max(0, Math.min(profile.maxS, s + sign * offset));
          return terrainSafeRadius({ ...view, center: profile.coordinateAt(distance), elevation: profile.elevationAt(distance) }, nominal, sampleElevation);
        }));
      }
      const wanted = Math.max(nominal, this.requiredRadius), previous = this.radius ?? nominal;
      const eased = previous + (wanted - previous) * (1 - Math.exp(-elapsed / (wanted > previous ? 350 : 1500)));
      // Never submit a camera below the DEM: Mapbox otherwise clamps it on
      // every frame, fighting our next pose and making the terrain jump.
      this.radius = terrainSafeRadius(view, nominal, sampleElevation, eased);
    } else this.radius = nominal;
    return { ...view, radius: this.radius };
  }
}
