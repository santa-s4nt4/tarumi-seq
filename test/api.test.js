import test from 'node:test';
import assert from 'node:assert/strict';
import { PositionApi, validateEndpoint, API_INTERVAL_MS } from '../src/api.js';

const result = direction => ({ direction, position: {}, next: {}, river: {}, upcoming: [] });
test('polls after five wall-clock seconds, sends the latest GPS, and cancels a scheduled poll on pause', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0, gpsTime = 419;
  t.mock.method(performance, 'now', () => now);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { requests.push(JSON.parse(options.body)); return Response.json(result('front')); });
  const client = new PositionApi(() => {}, () => {});
  t.after(() => client.reset());
  client.pending = { body: { direction: 'front', time: gpsTime }, t: gpsTime }; await client.run();
  client.enqueue(() => ({ body: { direction: 'front', time: gpsTime }, t: gpsTime }));
  now = 4999; gpsTime = 429; t.mock.timers.tick(4999); assert.equal(requests.length, 1);
  now = 5000; t.mock.timers.tick(1); await Promise.resolve(); await Promise.resolve();
  assert.equal(requests.length, 2); assert.equal(requests[1].time, 429); assert.equal(API_INTERVAL_MS, 5000);
  client.enqueue({ direction: 'front', time: 430 }, 430); client.cancelPending();
  now = 5000; t.mock.timers.tick(5000); assert.equal(requests.length, 2);
});
test('a late response from a previous direction cannot overwrite the current direction', async t => {
  const requests = [], results = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => requests.push({ options, resolve })));
  const client = new PositionApi(r => results.push(r), () => {});
  t.after(() => client.reset());
  client.pending = { body: { direction: 'front' }, t: 419 };
  const first = client.run();
  client.reset();
  client.pending = { body: { direction: 'back' }, t: 3 };
  const second = client.run();
  requests[1].resolve(Response.json(result('back'))); await second;
  requests[0].resolve(Response.json(result('front'))); await first;
  assert.equal(results.length, 1); assert.equal(results[0].direction, 'back');
});
test('reports a real API error without substituting reference predictions', async t => {
  const statuses = [], results = [];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'outside_recorded_route', message: 'ルート外' }, { status: 422 }));
  const client = new PositionApi(r => results.push(r), s => statuses.push(s));
  t.after(() => client.reset()); client.pending = { body: { direction: 'front' }, t: 419 }; await client.run();
  assert.equal(results.length, 0); assert.equal(statuses.at(-1).status, 'error'); assert.match(statuses.at(-1).message, /422.*ルート外/);
});
test('rejects credential URLs and non-HTTP protocols', () => {
  assert.throws(() => validateEndpoint('javascript:alert(1)'));
  assert.throws(() => validateEndpoint('https://user:pass@example.com/api/position'));
  assert.equal(validateEndpoint('http://localhost:8787/api/position'), 'http://localhost:8787/api/position');
});
