import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { departures, scheduleStops, buildSimulation, simulationPrediction, serviceTime, serviceSeconds } from '../src/simulation.js';
import { sampleAt } from '../src/timeline.js';
import { CueQueue } from '../src/cues.js';
const read = name => JSON.parse(fs.readFileSync(new URL(`../public/data/${name}.json`, import.meta.url)));
const timetable = read('timetable'), railway = read('railway-route'), stations = read('stations').stations;
const make = (trainId, stationOrder = timetable.trains.find(t => t.id === trainId).stops[0].station, day = 'weekday') => buildSimulation(timetable, railway, stations, { trainId, stationOrder, day });

test('imports only the 22 Motosu–Tarumi services and prevents departing outside the section or from a terminus', () => {
  assert.equal(timetable.trains.length, 22);
  assert.equal(timetable.trains.reduce((n, t) => n + t.stops.length, 0), 242);
  assert.ok(timetable.trains.every(train => train.stops.every(stop => stop.station >= 9 && stop.station <= 19)));
  assert.ok(!timetable.trains.some(train => ['1001', '1002', '36', '41'].includes(train.id)));
  assert.equal(departures(timetable, 'front', 'weekday', 1).length, 0);
  assert.equal(departures(timetable, 'back', 'holiday', 9).length, 0);
  assert.deepEqual(departures(timetable, 'front', 'holiday', 9), departures(timetable, 'front', 'weekday', 9));
  assert.equal(departures(timetable, 'front', 'holiday', 19).length, 0);
  assert.equal(departures(timetable, 'back', 'holiday', 1).length, 0);
  assert.throws(() => make('5', 1), /発車/);
  assert.throws(() => make('5', 19), /発車/);
  assert.equal(serviceTime(serviceSeconds('23:29'), true), '23:29:00');
});

test('preserves published departure, Motosu arrival and terminus times, with explicit estimates elsewhere', () => {
  const plan = scheduleStops(timetable, '5', 9);
  assert.equal(serviceTime(plan.start), '07:45');
  assert.equal(serviceTime(plan.end), '08:19');
  const motosu = plan.stops.find(s => s.station === 9);
  assert.equal(serviceTime(motosu.arrivalSeconds), '07:45');
  assert.equal(serviceTime(motosu.departureSeconds), '07:45');
  assert.equal(motosu.estimatedArrival, false);
  const oribe = plan.stops.find(s => s.station === 10);
  assert.equal(serviceTime(oribe.arrivalSeconds, true), '07:46:30');
  assert.equal(oribe.estimatedArrival, true);
  assert.equal(serviceTime(oribe.departureSeconds), '07:47');
  const back = scheduleStops(timetable, '4', 19);
  assert.equal(back.stops.at(-1).station, 9);
  assert.equal(back.stops.at(-1).departureSeconds, null);
  assert.equal(serviceTime(back.end), '06:26');
});

test('supports a mid-route departure and both directions without carrying earlier checkpoints', () => {
  const front = make('13', 11), back = make('18', 14);
  assert.equal(serviceTime(front.start), '09:48');
  assert.equal(front.stops[0].name, '木知原');
  assert.equal(front.stops.at(-1).name, '樽見');
  assert.equal(back.stops[0].name, '高科');
  assert.equal(back.stops.at(-1).name, '本巣');
  assert.equal(simulationPrediction(front, front.start, []).next.station.name, '谷汲口');
  assert.equal(simulationPrediction(back, back.start, []).next.station.name, '神海');
  assert.ok(front.data.events.every(event => event.t >= front.start));
  assert.ok(back.data.events.every(event => event.t >= back.start));
});

test('an intermediate station dwell holds position and speed, freezes other cards and resumes at departure', () => {
  const simulation = make('13'), queue = new CueQueue();
  const departure = serviceSeconds('09:48'), arrival = departure - 30;
  const first = simulationPrediction(simulation, arrival, []), later = simulationPrediction(simulation, departure - 1, []);
  assert.equal(first.next.station.name, '木知原'); assert.equal(first.next.station.etaSeconds, 0);
  assert.equal(first.position.speedKmh, 0); assert.equal(later.position.speedKmh, 0);
  assert.equal(first.position.latitude, later.position.latitude);
  assert.equal(first.position.longitude, later.position.longitude);
  const frozen = queue.cards(first).map(card => card.etaSeconds);
  assert.deepEqual(queue.cards(later).map(card => card.etaSeconds), frozen);
  assert.equal(simulationPrediction(simulation, departure, []).next.station.name, '谷汲口');
  assert.ok(simulationPrediction(simulation, departure + 15, []).position.speedKmh > 0);
  assert.equal(sampleAt(simulation.recording.records, arrival + 15).speed, 0);
});

test('ends 1036 at the published Motosu arrival without continuing south and preserves transfer notes', () => {
  const simulation = make('1036');
  const motosu = simulation.stops.find(s => s.station === 9);
  assert.equal(serviceTime(motosu.arrivalSeconds), '19:44');
  assert.equal(motosu.departureSeconds, null);
  assert.equal(serviceTime(simulation.end), '19:44');
  assert.equal(simulation.stops.filter(s => s.station === 9).length, 1);
  assert.equal(simulationPrediction(simulation, simulation.end, []).position.speedKmh, 0);
  assert.equal(simulation.stops.at(-1).station, 9);
  assert.equal(simulation.train.continuation, undefined);
  assert.equal(make('21').train.transferStation, 9);
});

test('tunnel timing follows the selected train and changes the single card to passage while inside', () => {
  const simulation = make('13'), tunnel = simulation.tunnels[0], queue = new CueQueue();
  const before = queue.cards(simulationPrediction(simulation, tunnel.entryT - 1, []), 20).find(c => c.featureId === tunnel.id);
  const inside = simulationPrediction(simulation, tunnel.entryT + 1, []);
  const passage = queue.cards(inside, 20).find(c => c.featureId === tunnel.id);
  assert.equal(before.target, 'entrance'); assert.equal(inside.position.inTunnel, true);
  assert.equal(passage.target, 'exit'); assert.equal(passage.key, before.key);
  assert.equal(simulationPrediction(simulation, tunnel.exitT + 1, []).position.inTunnel, false);
  assert.throws(() => make('3', 1), /運行日/);
});

test('every service has a continuous section trajectory with exact station stops and endpoint', () => {
  for (const train of timetable.trains) {
    const simulation = make(train.id, train.stops[0].station, 'holiday'), records = simulation.recording.records;
    assert.equal(records[0].t, simulation.start); assert.equal(records.at(-1).t, simulation.end);
    assert.ok(records.every((record, index) => Number.isFinite(record.lat) && Number.isFinite(record.lon) && record.speed >= 0 && (!index || record.t - records[index - 1].t === 1)));
    for (const stop of simulation.stops) {
      const record = sampleAt(records, stop.arrivalSeconds);
      assert.ok(Math.abs(record.lat - stop.lat) < 1e-7); assert.ok(Math.abs(record.lon - stop.lon) < 1e-7);
      assert.equal(record.speed, 0);
    }
    assert.equal(simulationPrediction(simulation, simulation.end, []).position.speedKmh, 0);
  }
});
