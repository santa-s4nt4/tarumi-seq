import { buildSimulation, serviceTime } from './simulation.js';

export const japanDate = instant => new Date(instant + 9 * 3600000).toISOString().slice(0, 10);
export function serviceDayEpoch(date) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) throw new Error('参照日を確認してください');
  return Date.parse(`${date}T00:00:00+09:00`);
}
function timeSeconds(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 : null;
}
export function serviceDayAt(instant) {
  const local = new Date(instant + 9 * 3600000);
  return local.getUTCDay() === 0 || local.getUTCDay() === 6 ? 'holiday' : 'weekday';
}
export function differenceLabel(seconds) {
  if (!Number.isFinite(seconds)) return '差 —';
  const rounded = Math.round(seconds), value = Math.abs(rounded);
  if (!rounded) return '見込との差 ±0秒';
  const duration = value < 60 ? `${value}秒` : `${Math.floor(value / 60)}分${String(value % 60).padStart(2, '0')}秒`;
  return `見込との差 ${rounded > 0 ? '+' : '−'}${duration}（${rounded > 0 ? '遅い' : '早い'}）`;
}

// The scheduled times are a separate reference. They never replace a GPS ETA
// or advance a live journey when location updates stop.
export class TimetableReference {
  constructor(timetable, railway, stations) { Object.assign(this, { timetable, railway, stations }); this.disconnect(); }
  disconnect() { this.plan = null; this.date = null; }
  connect({ trainId, day = 'weekday', date }) {
    const epoch = serviceDayEpoch(date);
    const train = this.timetable.trains.find(item => item.id === trainId);
    if (!train) throw new Error('列車を選んでください');
    const plan = buildSimulation(this.timetable, this.railway, this.stations, { trainId, day, stationOrder: train.stops[0].station });
    this.plan = plan; this.date = date; this.epoch = epoch; this.day = day;
  }
  autoSelect({ now = Date.now(), direction = 'front' } = {}) {
    const date = japanDate(now), day = serviceDayAt(now);
    const local = new Date(now + 9 * 3600000);
    const current = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
    const choices = this.timetable.trains.filter(train => train.direction === direction &&
      (train.operatingDays === 'daily' || day === 'holiday')).map(train => {
      const first = train.stops.find(stop => stop.departure);
      const last = [...train.stops].reverse().find(stop => stop.arrival || stop.departure);
      const start = timeSeconds(first?.departure);
      let end = timeSeconds(last?.arrival ?? last?.departure);
      if (start === null || end === null) return null;
      if (end < start) end += 86400;
      const at = current < start && end >= 86400 ? current + 86400 : current;
      const distance = at < start ? start - at : at > end ? at - end : 0;
      const origin = first.station;
      return { train, day, date, stationOrder: origin, distance, start };
    }).filter(Boolean).sort((a, b) => a.distance - b.distance || b.start - a.start);
    for (const choice of choices) {
      try {
        this.connect({ trainId: choice.train.id, day, date, stationOrder: choice.stationOrder });
        return this.plan;
      } catch { /* Skip a train whose published stop data cannot form a route. */ }
    }
    this.disconnect();
    return null;
  }
  comparison(event, now, direction) {
    if (!this.plan || direction !== this.plan.train.direction || !event || !Number.isFinite(now)) return null;
    const match = this.plan.data.events.find(item => item.type === event.type && (event.type === 'station'
      ? item.name === event.name : item.featureId === event.featureId && item.target === event.target));
    if (!match) return null;
    const stop = event.type === 'station' ? this.plan.stops.find(item => item.name === event.name) : null;
    const origin = stop === this.plan.stops[0];
    // An originating station has a published departure, not an arrival.
    if (origin && !stop.arrival) return null;
    const seconds = origin && stop.arrival ? Number(stop.arrival.slice(0, 2)) * 3600 + Number(stop.arrival.slice(3)) * 60 : match.t;
    const scheduledAt = this.epoch + seconds * 1000;
    const estimated = event.type === 'tunnel' || Boolean(stop?.estimatedArrival);
    const deltaSeconds = Number.isFinite(event.etaSeconds) && !event.arrived ? (now + event.etaSeconds * 1000 - scheduledAt) / 1000 : null;
    return { scheduledAt, seconds, estimated, deltaSeconds, departure: stop?.departure ?? null,
      label: `ダイヤ${event.type === 'station' ? '着' : event.target === 'exit' ? '終了' : '開始'} ${serviceTime(seconds, estimated)}${estimated ? ' *' : ''}` };
  }
}
