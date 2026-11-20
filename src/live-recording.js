import { recordedAt } from './timeline.js';
import { positionAlong } from './simulation.js';

// A recording advances the timetable and GPS fixes on the same recorded clock.
export class LiveRecording {
  constructor(data, fleet, profile, tick) {
    const { records } = data;
    this.epoch = Date.parse(recordedAt(data, 0));
    this.start = records[0].t;
    this.end = records.at(-1).t;
    this.records = records;
    this.fleet = fleet;
    this.tick = tick;
    this.index = -1;
    const now = this.now(tick);
    const measured = profile.project(records[0].lon, records[0].lat).s;
    const difference = run => Math.abs(positionAlong(run, run.secondsAt(now)).s - measured);
    this.train = fleet.at(now).active.filter(run => run.train.direction === data.id)
      .sort((a, b) => difference(a) - difference(b))[0];
  }
  now(tick) { return this.epoch + this.start * 1000 + (tick - this.tick); }
  takeFix(now) {
    const elapsed = (now - this.epoch) / 1000;
    let i = this.index;
    while (i + 1 < this.records.length && this.records[i + 1].t <= elapsed) i++;
    if (i === this.index) return null;
    this.index = i;
    const point = this.records[i];
    // The synchronized recording has no horizontal accuracy field. Zero denotes
    // the stored coordinate for replay only and is never presented as measured accuracy.
    return { timestamp: this.epoch + point.t * 1000, coords: { latitude: point.lat, longitude: point.lon,
      accuracy: 0, speed: Number.isFinite(point.speed) ? point.speed / 3.6 : null } };
  }
}
