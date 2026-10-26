import { createRailProfile } from './rail-elevation.js';

export const LIVE_MAX_ACCURACY = 50;
export const LIVE_MAX_ROUTE_OFFSET = 100;
export const LIVE_FRESH_MS = 3000;
const MOVING_SPEED = 0.8;

// This model uses the device's measured position and speed, independently of
// the recorded journey clock. Nothing in it reads or replays a GPS recording.
export class LivePrediction {
  constructor(railway, stationCatalog, direction = 'front') {
    this.profile = createRailProfile(railway);
    this.stations = railway.stations.map(station => ({ ...station, ...stationCatalog.find(item => item.order === station.order) }));
    this.tunnels = railway.tunnels;
    this.setDirection(direction);
  }
  reset() { this.fix = null; this.measurement = null; this.speedAnchor = null; this.status = 'waiting'; }
  setDirection(direction) { this.direction = direction === 'back' ? 'back' : 'front'; this.sign = this.direction === 'front' ? 1 : -1; this.reset(); }
  accept(position, now = Date.now()) {
    const c = position?.coords, timestamp = position?.timestamp;
    if (!c || !Number.isFinite(c.latitude) || Math.abs(c.latitude) > 90 || !Number.isFinite(c.longitude) || Math.abs(c.longitude) > 180 || !Number.isFinite(timestamp)) {
      this.status = 'invalid'; return false;
    }
    if (now - timestamp > LIVE_FRESH_MS || timestamp - now > 5000) { this.status = 'stale'; return false; }
    if (this.fix && timestamp <= this.fix.timestamp) return false;
    this.measurement = { accuracy: c.accuracy, timestamp };
    if (!Number.isFinite(c.accuracy) || c.accuracy < 0 || c.accuracy > LIVE_MAX_ACCURACY) { this.status = 'accuracy'; return false; }
    const projected = this.profile.project(c.longitude, c.latitude, this.fix?.s);
    this.measurement.offsetMeters = projected.offsetMeters;
    if (projected.offsetMeters > LIVE_MAX_ROUTE_OFFSET) { this.status = 'off-route'; return false; }
    const previous = this.fix, seconds = previous ? (timestamp - previous.timestamp) / 1000 : null;
    const delta = previous ? projected.s - previous.s : 0;
    if (previous && seconds > 0 && Math.abs(delta) > 55 * seconds + previous.accuracy + c.accuracy + 30) { this.status = 'jump'; return false; }
    if (previous && this.sign * delta < -Math.max(30, previous.accuracy + c.accuracy)) { this.status = 'direction'; return false; }
    let speed = Number.isFinite(c.speed) && c.speed >= 0 && c.speed <= 55 ? c.speed : null;
    let speedSource = speed === null ? null : 'device';
    const anchor = this.speedAnchor;
    const span = anchor ? (timestamp - anchor.timestamp) / 1000 : 0;
    if (speed === null && anchor && span > 0 && span <= 15) {
      if (span >= 2) {
        const movement = this.sign * (projected.s - anchor.s);
        const noise = Math.max(3, (anchor.accuracy + c.accuracy) / 4);
        speed = movement <= noise ? 0 : Math.min(55, movement / span);
      } else speed = previous?.speed ?? null;
      speedSource = speed === null ? null : 'position-difference';
    }
    if (!anchor || speedSource === 'device' || span >= 4) this.speedAnchor = { s: projected.s, accuracy: c.accuracy, timestamp };
    // Reject small backwards GPS jitter while preserving a genuine direction
    // change as an explicit user choice.
    const s = previous ? this.sign > 0 ? Math.max(previous.s, projected.s) : Math.min(previous.s, projected.s) : projected.s;
    this.fix = { ...projected, s, speed, speedSource, accuracy: c.accuracy, timestamp };
    this.status = 'tracking';
    return true;
  }
  snapshot(now = Date.now()) {
    if (!this.fix || this.status !== 'tracking') return { status: this.status, measurement: this.measurement, prediction: null };
    const age = Math.max(0, now - this.fix.timestamp);
    if (age > LIVE_FRESH_MS) return { status: 'stale', measurement: this.measurement, prediction: null };
    const speed = this.fix.speed;
    const moving = Number.isFinite(speed) && speed >= MOVING_SPEED;
    // Smooth only the first 1.5 seconds between fixes. A missing GPS fix never
    // becomes an unbounded trip simulation, especially inside a tunnel.
    const s = Math.max(0, Math.min(this.profile.maxS, this.fix.s + (moving ? this.sign * speed * Math.min(age / 1000, 1.5) : 0)));
    const [longitude, latitude] = this.profile.coordinateAt(s);
    const tunnel = this.tunnels.find(item => s >= item.start && s < item.end);
    const eta = distance => moving ? Math.max(0, distance) / speed : null;
    const stations = this.stations.flatMap(station => {
      const distance = this.sign * (station.s - s);
      const arrived = speed !== null && speed < MOVING_SPEED && Math.abs(station.s - this.fix.s) <= 30;
      if (distance < -5 && !arrived) return [];
      return [{ id: `live-station-${station.order}`, key: `station:${station.order}`, type: 'station', target: 'arrival', name: station.name,
        distanceMeters: Math.max(0, distance), etaSeconds: arrived ? 0 : eta(distance), arrived }];
    });
    const tunnels = this.tunnels.flatMap(item => {
      const inside = tunnel?.id === item.id;
      const targetS = inside ? this.sign > 0 ? item.end : item.start : this.sign > 0 ? item.start : item.end;
      const distance = this.sign * (targetS - s);
      if (distance < 0) return [];
      return [{ id: `live-${item.id}`, key: `tunnel:${item.id}`, featureId: item.id, type: 'tunnel', target: inside ? 'exit' : 'entrance', name: item.name,
        distanceMeters: distance, etaSeconds: eta(distance) }];
    });
    const upcoming = [...stations, ...tunnels].sort((a, b) => a.distanceMeters - b.distanceMeters);
    return { status: 'tracking', measurement: this.measurement, prediction: {
      direction: this.direction, source: 'device_gps', upcoming,
      next: { station: upcoming.find(event => event.type === 'station') ?? null, tunnel: upcoming.find(event => event.type === 'tunnel') ?? null },
      position: { longitude, latitude, s, speedMetersPerSecond: speed, speedKmh: speed === null ? null : speed * 3.6,
        speedSource: this.fix.speedSource, accuracy: this.fix.accuracy, timestamp: this.fix.timestamp, inTunnel: Boolean(tunnel), tunnelId: tunnel?.id ?? null },
    } };
  }
}
