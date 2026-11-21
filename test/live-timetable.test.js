import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LiveTimetable } from '../src/live-timetable.js';
import { positionAlong } from '../src/simulation.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url)));
const fleet = () => new LiveTimetable(read('timetable-reference'), read('railway-route'), read('stations').stations);
const at = (day, time) => Date.parse(`${day}T${time}+09:00`);
const saturday = '2026-11-21';

test('all active runs are independent, follow their own termini and respect the Japanese service day', () => {
  const model = fleet();
  const ids = (day, time) => model.at(at(day, time)).active.map(run => run.train.id);
  assert.deepEqual(ids(saturday, '07:25:00'), ['5', '8', '10']);
  assert.deepEqual(ids(saturday, '03:00:00'), []);
  assert.ok(ids(saturday, '11:25:00').includes('1001'));
  assert.ok(ids('2026-11-23', '11:25:00').includes('1001')); // Monday, Labour Thanksgiving Day
  assert.ok(!ids('2026-11-24', '11:25:00').includes('1001'));
  const { active, seconds } = model.at(at(saturday, '07:40:00'));
  const down = active.find(run => run.train.id === '5');
  const p = down.snapshot(seconds);
  assert.equal(p.next.station.name, '本巣');
  assert.equal(p.position.speedKmh, 0);
  assert.equal(p.next.station.etaSeconds, 0);
});

test('only confirmed outdoor fixes adjust a single train and extend its operating window', () => {
  const model = fleet();
  const { active, seconds } = model.at(at(saturday, '07:24:00'));
  const run = active.find(run => run.train.id === '5');
  const fix = offset => ({ timestamp: (seconds + offset) * 1000, s: positionAlong(run, seconds + offset - 45).s, accuracy: 3 });
  assert.equal(run.observe(fix(0), seconds), false);
  assert.equal(run.observe(fix(3), seconds + 3), true);
  assert.equal(run.delay, 45);
  assert.equal(run.snapshot(seconds + 3).next.station.etaSeconds, 132);
  assert.ok(active.filter(other => other !== run).every(other => other.delay === 0));
  assert.ok(model.at(at(saturday, '08:19:40')).active.includes(run));
  assert.ok(!model.at(at(saturday, '08:19:46')).active.includes(run));
});

test('no correction during the last ten seconds or inside a tunnel, even from a good outdoor fix', () => {
  const { active } = fleet().at(at(saturday, '07:25:00'));
  const run = active.find(run => run.train.id === '5');
  const tunnel = run.tunnels[0];
  for (const t of [tunnel.entryT - 9, tunnel.entryT - 6, tunnel.entryT + 1, tunnel.entryT + 4]) {
    assert.equal(run.observe({ timestamp: t * 1000, s: positionAlong(run, tunnel.entryT - 50).s, accuracy: 2 }, t), false);
    assert.equal(run.delay, 0);
  }
  const exit = run.snapshot(tunnel.entryT + 4).upcoming[0];
  assert.equal(exit.target, 'exit');
  assert.ok(Math.abs(exit.etaSeconds - (tunnel.exitT - tunnel.entryT - 4)) < 0.001);
  for (const t of [tunnel.exitT + 15, tunnel.exitT + 18]) {
    assert.equal(run.observe({ timestamp: t * 1000, s: (tunnel.start + tunnel.end) / 2, accuracy: 2 }, t), false);
  }
  assert.equal(run.snapshot(tunnel.exitT + 1).position.inTunnel, false);
});

test('station arrivals no longer lock GPS correction for a countdown', () => {
  const model = fleet();
  const run = model.at(at(saturday, '07:25:00')).active.find(run => run.train.id === '5');
  const station = run.stops[1];
  assert.equal(run.snapshot(station.arrivalSeconds - 9).upcoming[0].type, 'station');
  assert.equal(run.protectedAt(station.arrivalSeconds - 9), false);
  assert.equal(run.protectedAt(station.arrivalSeconds), false);
});

test('a train already being followed can finish after midnight without delaying the next service day', () => {
  const model = fleet();
  const run = model.at(at(saturday, '23:10:00')).active.find(item => item.train.id === '41');
  run.delay = 2400;
  const afterMidnight = model.at(at('2026-11-22', '00:01:00'));
  assert.deepEqual(afterMidnight.active, [run]);
  assert.equal(afterMidnight.next.start, 5 * 3600 + 37 * 60);
  assert.deepEqual(model.at(at('2026-11-22', '00:10:00')).active, []);
  assert.equal(model.at(at('2026-11-22', '23:10:00')).active[0].delay, 0);
});
