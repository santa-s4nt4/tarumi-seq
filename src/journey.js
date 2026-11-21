import { scheduleStops, buildScheduledRun, positionAlong, serviceSeconds } from './simulation.js';
import { serviceDayAt, serviceDayEpoch, japanDate } from './timetable-reference.js';

export const directionName = direction => direction === 'front' ? '樽見行き' : '大垣行き';
// Services terminating at Motosu from Ogaki never enter the experience section.
export const servesExperienceSection = train => [9, 19].every(station => train.stops.some(stop => stop.station === station));
// Keep the diagram's published section departure/arrival times, including
// through trains' Motosu calls, without changing the full timetable used by LIVE.
export function customTimetable(timetable) {
  return { ...timetable, section: { firstStation: 9, lastStation: 19, label: '本巣 — 樽見' },
    trains: timetable.trains.filter(servesExperienceSection).map(train => {
      const stops = train.stops.filter(stop => stop.station >= 9 && stop.station <= 19)
        .map(stop => ({ ...stop }));
      stops.at(-1).departure = null;
      return { ...train, stops };
    }) };
}
export function services(timetable, direction, day) {
  return timetable.trains.filter(train => servesExperienceSection(train) && train.direction === direction && (train.operatingDays === 'daily' || day === 'holiday'))
    .sort((a, b) => serviceSeconds(a.stops[0].departure) - serviceSeconds(b.stops[0].departure));
}
export function activeServices(timetable, now) {
  const seconds = (now - serviceDayEpoch(japanDate(now))) / 1000;
  return timetable.trains.filter(train => {
    if (!servesExperienceSection(train)) return false;
    if (train.operatingDays === 'holiday' && serviceDayAt(now) !== 'holiday') return false;
    const plan = scheduleStops(timetable, train.id, train.stops[0].station, serviceDayAt(now));
    return seconds >= plan.start && seconds <= plan.end;
  });
}
export function nearestRun(runs, profile, position, now) {
  if (!position || !Number.isFinite(position.coords?.accuracy) || position.coords.accuracy > 50 ||
      now - position.timestamp > 15000 || position.timestamp - now > 5000) return null;
  const point = profile.project(position.coords.longitude, position.coords.latitude);
  if (point.offsetMeters > 100) return null;
  const choices = runs.map(run => ({ run, difference: Math.abs(positionAlong(run, run.secondsAt(now) - run.delay).s - point.s) }))
    .sort((a, b) => a.difference - b.difference);
  // Crossings can put two trains together. Wait for an unambiguous fix instead
  // of silently choosing a direction that cannot be inferred from one point.
  if (!choices.length || choices[0].difference > 3000 || (choices[1] && choices[1].difference - choices[0].difference < 150)) return null;
  return choices[0].run;
}
export function customPlan(timetable, railway, stations, selection) {
  const section = customTimetable(timetable);
  const train = section.trains.find(train => train.id === selection.trainId);
  if (!train) throw new Error('列車を選んでください。');
  return buildScheduledRun(section, railway, stations, { trainId: train.id, day: selection.day,
    stationOrder: train.stops[0].station });
}

export class StationRange {
  constructor(stops, from, to) {
    this.stops = stops;
    const first = stops.findIndex(stop => stop.station === Number(from));
    const last = stops.findIndex(stop => stop.station === Number(to));
    this.first = first >= 0 && first < stops.length - 1 ? first : 0;
    this.last = last > this.first ? last : stops.length - 1;
  }
  set(which, index) {
    index = Math.round(Number(index));
    if (!Number.isFinite(index)) return;
    if (which === 'in') this.first = Math.max(0, Math.min(this.last - 1, index));
    else this.last = Math.max(this.first + 1, Math.min(this.stops.length - 1, index));
  }
  get start() { return this.stops[this.first].departureSeconds; }
  get end() { return this.stops[this.last].arrivalSeconds; }
  clamp(time) { return Math.max(this.start, Math.min(this.end, time)); }
  contains(event) { return event.t >= this.start && event.t <= this.end; }
}
