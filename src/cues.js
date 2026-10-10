const eventKey = event => event.id ?? `${event.type}:${event.name}:${event.target}`;
const tunnelKey = event => event.featureId ?? event.name;

export class CueQueue {
  constructor() { this.reset(); }
  reset() { this.stopId = null; this.frozenEtas = new Map(); }

  cards(prediction, limit = 3) {
    if (!prediction) return [];
    const station = prediction.next?.station;
    const stopId = station && Number.isFinite(station.etaSeconds) && Math.round(station.etaSeconds) === 0 ? eventKey(station) : null;
    if (stopId !== this.stopId) { this.reset(); this.stopId = stopId; }
    const events = (prediction.upcoming ?? []).filter(event => event.type === 'station' || event.type === 'tunnel').map(event => {
      if (!stopId) return event;
      const key = eventKey(event);
      if (!this.frozenEtas.has(key)) this.frozenEtas.set(key, event.etaSeconds);
      return { ...event, etaSeconds: this.frozenEtas.get(key) };
    });
    const stations = events.filter(event => event.type === 'station').map(event => ({ ...event, key: `station:${eventKey(event)}` }));
    const tunnels = new Map();
    for (const event of events.filter(event => event.type === 'tunnel')) {
      const key = tunnelKey(event);
      if (!tunnels.has(key)) tunnels.set(key, []);
      tunnels.get(key).push(event);
    }
    const checkpoints = [...tunnels].map(([key, pair]) => {
      const inside = prediction.position?.inTunnel && prediction.position.tunnelId === key;
      const event = pair.find(event => event.target === (inside ? 'exit' : 'entrance')) ?? pair[0];
      return { ...event, key: `tunnel:${key}` };
    });
    return [...stations, ...checkpoints].sort((a, b) =>
      (Number.isFinite(a.etaSeconds) ? a.etaSeconds : Infinity) - (Number.isFinite(b.etaSeconds) ? b.etaSeconds : Infinity)).slice(0, limit);
  }
}
