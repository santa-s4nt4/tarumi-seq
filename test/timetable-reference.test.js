import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TimetableReference, japanDate, serviceDayEpoch, differenceLabel } from '../src/timetable-reference.js';
const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url)));
const timetable = read('timetable-reference'), railway = read('railway-route'), stations = read('stations').stations;
const date = '2026-10-26', epoch = serviceDayEpoch(date);
const model = () => new TimetableReference(timetable, railway, stations);
const event = (name, etaSeconds = 60) => ({ type: 'station', name, etaSeconds });

test('full-line reference imports all 44 passenger trains without changing the 22-train simulation section', () => {
  assert.equal(timetable.trains.length, 44);
  assert.equal(timetable.trains.reduce((sum, t) => sum + t.stops.length, 0), 600);
  assert.equal(read('timetable').trains.length, 22);
  assert.ok(read('timetable').trains.every(t => t.stops.every(s => s.station >= 9)));
  for (const train of timetable.trains) {
    const reference = model(); reference.connect({ trainId: train.id, day: 'holiday', date });
    assert.ok(reference.plan.stops.length >= 2);
    assert.ok(reference.plan.end > reference.plan.start);
  }
  assert.equal(timetable.trains.find(t => t.id === '17').stops.at(-1).arrival, '11:49');
  assert.equal(timetable.trains.find(t => t.id === '20').stops.at(-1).arrival, '13:06');
  assert.equal(timetable.trains.find(t => t.id === '23').stops.at(-1).arrival, '16:16');
  assert.equal(timetable.trains.find(t => t.id === '28').stops.at(-1).arrival, '17:33');
});
test('compares GPS/replay arrival estimates with the selected train on a fixed Japanese service date', () => {
  const reference = model(); reference.connect({ trainId: '17', date });
  const result = reference.comparison(event('樽見', 75), epoch + (11 * 3600 + 48 * 60) * 1000, 'front');
  assert.equal(result.label, 'ダイヤ着 11:49');
  assert.equal(result.estimated, false);
  assert.equal(result.deltaSeconds, 15);
  assert.equal(differenceLabel(result.deltaSeconds), '見込との差 +15秒（遅い）');
  assert.equal(differenceLabel(-75), '見込との差 −1分15秒（早い）');
  assert.equal(differenceLabel(0), '見込との差 ±0秒');
  assert.equal(japanDate(Date.parse('2026-10-25T15:00:00Z')), date);
  const nextDay = reference.comparison(event('樽見', 75), epoch + (11 * 3600 + 48 * 60) * 1000 + 86400000, 'front');
  assert.equal(nextDay.deltaSeconds, 86415); // Never wrap a wrong day into a small error.
});
test('marks inferred intermediate arrivals and tunnel times separately from published times', () => {
  const reference = model(); reference.connect({ trainId: '17', date });
  const station = reference.comparison(event('神海'), epoch, 'front');
  assert.equal(station.label, 'ダイヤ着 11:29:30 *');
  assert.equal(station.departure, '11:30');
  assert.equal(station.estimated, true);
  const motosu = reference.comparison(event('本巣'), epoch, 'front');
  assert.equal(motosu.label, 'ダイヤ着 11:07');
  assert.equal(motosu.departure, '11:16');
  const tunnel = reference.plan.data.events.find(e => e.type === 'tunnel');
  assert.equal(reference.comparison(tunnel, epoch, 'front').estimated, true);
});
test('unknown ETA, dwell, wrong direction and out-of-service targets do not create misleading differences', () => {
  const reference = model();
  assert.equal(reference.comparison(event('樽見'), epoch, 'front'), null);
  reference.connect({ trainId: '3', date });
  assert.equal(reference.comparison(event('樽見'), epoch, 'front'), null);
  assert.equal(reference.comparison(event('本巣'), epoch, 'back'), null);
  assert.equal(reference.comparison(event('本巣', null), epoch, 'front').deltaSeconds, null);
  assert.equal(reference.comparison({ ...event('本巣', 0), arrived: true }, epoch, 'front').deltaSeconds, null);
  assert.equal(differenceLabel(null), '差 —');
  reference.disconnect(); assert.equal(reference.comparison(event('本巣'), epoch, 'front'), null);
});
test('holiday-only trains and the Motosu transfer/1036 endpoint remain explicit', () => {
  const reference = model();
  assert.throws(() => reference.connect({ trainId: '1001', date }), /運行日/);
  reference.connect({ trainId: '1001', date, day: 'holiday' });
  assert.equal(reference.plan.stops.at(-1).name, '本巣');
  reference.connect({ trainId: '1036', date });
  assert.equal(reference.plan.stops.at(-1).station, 9);
  reference.connect({ trainId: '23', date }); assert.match(reference.plan.train.note, /乗り換え/);
  assert.throws(() => serviceDayEpoch('2026-02-30'), /参照日/);
});
