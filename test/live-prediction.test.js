import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePrediction, LIVE_FRESH_MS } from '../src/live-prediction.js';

const railway = { coordinates: [[136.64, 35.5], [136.64, 35.51]], elevationAnchors: [{ s: 0, meters: 50 }, { s: 1200, meters: 60 }],
  stations: [{ order: 1, s: 0 }, { order: 2, s: 500 }, { order: 3, s: 1000 }], tunnels: [{ id: 't1', name: 'トンネル1', start: 700, end: 800 }] };
const catalog = [{ order: 1, name: 'A' }, { order: 2, name: 'B' }, { order: 3, name: 'C' }];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} ≈ ${expected}`);
function fix(model, s, timestamp = 100000, { speed = 10, accuracy = 5 } = {}) {
  const [longitude, latitude] = model.profile.coordinateAt(s);
  return { timestamp, coords: { longitude, latitude, speed, accuracy } };
}

test('live GPS uses measured distance and speed, smooths briefly and clears stale predictions', () => {
  const model = new LivePrediction(railway, catalog);
  assert.equal(model.snapshot(100000).prediction, null);
  assert.equal(model.accept(fix(model, 400), 100000), true);
  near(model.snapshot(100000).prediction.next.station.etaSeconds, 10);
  near(model.snapshot(100500).prediction.next.station.etaSeconds, 9.5);
  near(model.snapshot(102000).prediction.next.station.etaSeconds, 8.5);
  assert.equal(model.snapshot(100001 + LIVE_FRESH_MS).status, 'stale');
  assert.equal(model.snapshot(100001 + LIVE_FRESH_MS).prediction, null);
});

test('a stationary device has no future ETA and an arrived station is zero', () => {
  const model = new LivePrediction(railway, catalog);
  model.accept(fix(model, 500, 100000, { speed: 0 }), 100000);
  const prediction = model.snapshot(100000).prediction;
  assert.equal(prediction.next.station.name, 'B');
  assert.equal(prediction.next.station.arrived, true);
  assert.equal(prediction.next.station.etaSeconds, 0);
  assert.equal(prediction.next.tunnel.etaSeconds, null);
  near(prediction.position.s, 500);
});

test('missing device speed waits for a position baseline and does not turn GPS jitter into movement', () => {
  const model = new LivePrediction(railway, catalog);
  model.accept(fix(model, 400, 100000, { speed: null }), 100000);
  assert.equal(model.snapshot(100000).prediction.next.station.etaSeconds, null);
  model.accept(fix(model, 401, 101000, { speed: null }), 101000);
  assert.equal(model.snapshot(101000).prediction.position.speedMetersPerSecond, null);
  model.accept(fix(model, 402, 102000, { speed: null }), 102000);
  assert.equal(model.snapshot(102000).prediction.position.speedMetersPerSecond, 0);
  model.accept(fix(model, 430, 103000, { speed: null }), 103000);
  near(model.snapshot(103000).prediction.position.speedMetersPerSecond, 10);
  assert.equal(model.snapshot(103000).prediction.position.speedSource, 'position-difference');
});

test('tunnel entry and passage follow the actual selected travel direction', () => {
  const model = new LivePrediction(railway, catalog, 'back');
  model.accept(fix(model, 900), 100000);
  let prediction = model.snapshot(100000).prediction;
  assert.equal(prediction.next.tunnel.target, 'entrance');
  near(prediction.next.tunnel.etaSeconds, 10);
  model.accept(fix(model, 790, 111000), 111000);
  prediction = model.snapshot(111000).prediction;
  assert.equal(prediction.position.inTunnel, true);
  assert.equal(prediction.next.tunnel.target, 'exit');
  near(prediction.next.tunnel.etaSeconds, 9);
  assert.equal(prediction.next.station.name, 'B');
  model.setDirection('front');
  assert.equal(model.snapshot(111000).prediction, null);
  model.accept(fix(model, 790, 112000), 112000);
  near(model.snapshot(112000).prediction.next.tunnel.etaSeconds, 1);
});

test('poor accuracy, off-route fixes, old fixes and impossible jumps cannot issue cues', () => {
  const model = new LivePrediction(railway, catalog);
  model.accept(fix(model, 400), 100000);
  assert.equal(model.accept(fix(model, 410, 101000, { accuracy: 80 }), 101000), false);
  assert.equal(model.snapshot(101000).status, 'accuracy');
  assert.equal(model.snapshot(101000).prediction, null);
  const outside = fix(model, 400, 102000); outside.coords.longitude += 0.01;
  model.accept(outside, 102000);
  assert.equal(model.snapshot(102000).status, 'off-route');
  model.accept(fix(model, 1000, 101000), 101000);
  assert.equal(model.snapshot(101000).status, 'jump');
  model.accept(fix(model, 420, 100000), 110000);
  assert.equal(model.snapshot(110000).status, 'stale');
  model.accept(fix(model, 420, 110000), 110000);
  assert.equal(model.snapshot(110000).status, 'tracking');
});

test('reversed movement prompts a direction choice; invalid coordinates never match', () => {
  const model = new LivePrediction(railway, catalog);
  model.accept(fix(model, 500), 100000);
  model.accept(fix(model, 400, 110000), 110000);
  assert.equal(model.snapshot(110000).status, 'direction');
  assert.equal(model.snapshot(110000).prediction, null);
  model.setDirection('back');
  model.accept(fix(model, 400, 111000), 111000);
  assert.equal(model.snapshot(111000).status, 'tracking');
  model.accept({ coords: { latitude: NaN, longitude: 136 }, timestamp: 112000 }, 112000);
  assert.equal(model.snapshot(112000).status, 'invalid');
});
