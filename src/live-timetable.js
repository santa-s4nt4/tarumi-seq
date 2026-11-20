import { buildScheduledRun, positionAlong, scheduledEventsAt, timeAtDistance } from './simulation.js';
import { japanDate, serviceDayAt, serviceDayEpoch } from './timetable-reference.js';

export class LiveTimetable {
  constructor(timetable, railway, stations) {
    Object.assign(this, { timetable, railway, stations });
  }

  at(now) {
    const date = japanDate(now);
    if (this.date !== date) {
      const epoch = serviceDayEpoch(date);
      const continuing = (this.runs ?? []).filter(run => run.epoch < epoch && run.activeAt(now));
      this.date = date;
      this.epoch = epoch;
      const day = serviceDayAt(now);
      this.runs = this.timetable.trains
        .filter(train => train.operatingDays === 'daily' || day === 'holiday')
        .map(train => new TrainRun(buildScheduledRun(this.timetable, this.railway, this.stations, {
          trainId: train.id, stationOrder: train.stops[0].station, day,
        }), this.epoch));
      this.runs.push(...continuing);
    }
    const seconds = (now - this.epoch) / 1000;
    const active = this.runs.filter(run => run.activeAt(now));
    const next = this.runs.filter(run => run.epoch === this.epoch && seconds < run.start).sort((a, b) => a.start - b.start)[0];
    return { active, seconds, next };
  }
}

class TrainRun {
  constructor(plan, epoch) {
    Object.assign(this, plan);
    this.epoch = epoch;
    this.delay = 0;
    this.lastCountdownTime = -Infinity;
    this.clearFixes();
  }

  secondsAt(now) { return (now - this.epoch) / 1000; }

  activeAt(now) {
    const time = this.secondsAt(now);
    return time >= this.start && time <= this.end + this.delay;
  }

  clearFixes() { this.candidate = null; }

  snapshot(seconds) {
    const time = seconds - this.delay;
    const { s, speed } = positionAlong(this, time);
    const { upcoming, tunnel } = scheduledEventsAt(this, time, s);
    // Only one end of each tunnel is a cue at any given position.
    const cues = upcoming.filter(event => event.type === 'station' ||
      event.target === (event.featureId === tunnel?.id ? 'exit' : 'entrance'));
    return { direction: this.train.direction, upcoming: cues, next: { station: cues.find(cue => cue.type === 'station') },
      position: { s, speedKmh: speed, inTunnel: Boolean(tunnel), tunnelId: tunnel?.id } };
  }

  protectedAt(seconds) {
    const { position, upcoming } = this.snapshot(seconds);
    const event = upcoming[0];
    return position.inTunnel || (event?.etaSeconds > 0 && event.etaSeconds <= 10);
  }

  observe(fix, seconds) {
    if (this.protectedAt(seconds) || this.tunnels.some(t => fix.s >= t.start && fix.s <= t.end)) {
      this.clearFixes();
      return false;
    }
    let planned = timeAtDistance(this, fix.s);
    if (planned === null) { this.clearFixes(); return false; }
    // During a scheduled dwell the same coordinate represents a time interval.
    const stop = this.stops.find(stop => Math.abs(stop.s - fix.s) <= Math.max(10, fix.accuracy));
    if (stop) planned = Math.max(stop.arrivalSeconds, Math.min(seconds - this.delay, stop.departureSeconds ?? stop.arrivalSeconds));
    const delay = Math.max(0, Math.round(seconds - planned));
    const previous = this.candidate;
    if (!previous || fix.timestamp - previous.timestamp > 15000 || Math.abs(previous.delay - delay) > 10) {
      this.candidate = { delay, timestamp: fix.timestamp };
      return false;
    }
    if (fix.timestamp - previous.timestamp < 2000) return false;
    // Several metres of GPS jitter must not move the display on every fix.
    const cue = this.snapshot(seconds).upcoming[0]?.id;
    if (cue === this.lastAdjustedCue) return false;
    const confirmed = Math.min(delay, Math.max(0, Math.floor(seconds - this.lastCountdownTime) - 1));
    if (Math.abs(this.delay - confirmed) < 5) return false;
    this.delay = confirmed;
    this.lastAdjustedCue = this.snapshot(seconds).upcoming[0]?.id;
    this.clearFixes();
    return true;
  }
}
