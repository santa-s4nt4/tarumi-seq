import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sampleAt, recordedAt, advanceTime, stationEvent } from '../src/timeline.js';

test('interpolates short GPS intervals, clamps coverage, holds rather than inventing positions in long gaps', () => {
  const records = [{ t: 10, lat: 35, lon: 136, speed: 10 }, { t: 12, lat: 37, lon: 138, speed: 20 }, { t: 20, lat: 38, lon: 139, speed: 30 }];
  assert.equal(sampleAt(records, 11).lat, 36);
  assert.equal(sampleAt(records, 0).t, 10);
  assert.equal(sampleAt(records, 100).t, 20);
  assert.equal(sampleAt(records, 16).gap, true);
  assert.equal(sampleAt(records, 16).lat, 37);
});
test('uses elapsed wall time and playback rate; stops exactly at the recorded endpoint', () => {
  assert.deepEqual(advanceTime(419, 2, 4, 2211), { time: 427, ended: false });
  assert.deepEqual(advanceTime(2208, 1, 16, 2211), { time: 2211, ended: true });
});
test('converts synchronized video seconds back to the GPS clock with the original offset', () => {
  const front = JSON.parse(fs.readFileSync('data/gps-front.json', 'utf8'));
  const back = JSON.parse(fs.readFileSync('data/gps-back.json', 'utf8'));
  assert.equal(recordedAt(front, 419), '2026-07-17T03:53:56.000Z');
  assert.equal(recordedAt(back, 3), '2026-07-17T04:33:19.000Z');
  // The source generator extends the first fix backwards by up to five seconds.
  assert.ok(Math.abs(Date.parse(recordedAt(front, 419)) - Date.parse(front.meta.gps.gps_start)) < 5000);
  assert.ok(Math.abs(Date.parse(recordedAt(back, 3)) - Date.parse(back.meta.gps.gps_start)) < 5000);
  // gps_end describes the entire GPS log, which can extend beyond the synchronized video.
  assert.equal((Date.parse(recordedAt(back, 1741)) - Date.parse(recordedAt(back, 3))) / 1000, 1738);
});
test('station skipping uses each direction’s own event times', () => {
  const data = JSON.parse(fs.readFileSync('public/data/map-data.json', 'utf8'));
  assert.equal(stationEvent(data.front.events, 419, 1).name, '木知原');
  assert.equal(stationEvent(data.back.events, 3, 1).name, '樽見');
  assert.equal(stationEvent(data.front.events, 419, -1), undefined);
});
