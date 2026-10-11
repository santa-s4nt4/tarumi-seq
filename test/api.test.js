import test from 'node:test';
import assert from 'node:assert/strict';
import { PositionApi, validateEndpoint, API_INTERVAL_MS, requestEndpoint, DEFAULT_ENDPOINT, PUBLIC_ENDPOINT, LOCAL_ENDPOINT } from '../src/api.js';

const result = direction => ({ direction, position: {}, next: {}, river: {}, upcoming: [] });
test('uses the public position API by default and keeps local proxy opt-in', () => {
  assert.equal(DEFAULT_ENDPOINT, PUBLIC_ENDPOINT);
  assert.equal(new PositionApi(() => {}, () => {}).endpoint, PUBLIC_ENDPOINT);
  assert.equal(requestEndpoint(DEFAULT_ENDPOINT, true), PUBLIC_ENDPOINT);
  assert.equal(requestEndpoint(LOCAL_ENDPOINT, true), '/local-api/api/position');
});
test('proxies only the local position API in development, preserving production and public endpoints', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(requestEndpoint(`http://${host}:8787/api/position?debug=1`, true), '/local-api/api/position?debug=1');
  }
  for (const url of ['http://localhost:9999/api/position', 'http://localhost:8787/another-api', 'https://tarumi-api.santanaruse.workers.dev/api/position']) {
    assert.equal(requestEndpoint(url, true), url);
  }
  assert.equal(requestEndpoint('http://localhost:8787/api/position', false), 'http://localhost:8787/api/position');
});
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

const flushPromises = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('waits five seconds from response completion and dispatches the latest queued GPS', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0, gpsTime = 419, finish;
  t.mock.method(performance, 'now', () => now);
  const requests = [];
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(Response.json(result('front')));
  });
  const client = new PositionApi(() => {}, () => {});
  t.after(() => client.reset());
  client.pending = { body: { direction: 'front', time: gpsTime }, t: gpsTime };
  const first = client.run();
  client.enqueue(() => ({ body: { direction: 'front', time: gpsTime }, t: gpsTime }));
  now = 1000; t.mock.timers.tick(1000); finish(Response.json(result('front'))); await first;
  now = 5999; gpsTime = 425; t.mock.timers.tick(4999); assert.equal(requests.length, 1);
  now = 6000; t.mock.timers.tick(1); await flushPromises();
  assert.equal(requests.length, 2); assert.equal(requests[1].time, 425);
});

test('replays one dropped local prediction request without clearing the successful readout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [], statuses = [], results = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1 ? new Response('Error inside ProxyWorker: Network connection lost.', { status: 500 }) : Response.json(result('front'));
  });
  const client = new PositionApi(r => results.push(r), s => statuses.push(s), LOCAL_ENDPOINT);
  t.after(() => client.reset()); client.pending = { body: { direction: 'front', time: 419 }, t: 419 };
  const running = client.run(); await flushPromises();
  assert.equal(requests.length, 1); t.mock.timers.tick(300); await running;
  assert.deepEqual(requests[1], requests[0]); assert.equal(results.length, 1);
  assert.equal(statuses.at(-1).status, 'ok'); assert.equal(statuses.some(s => s.status === 'error'), false);
});

test('limits local retries to one and never retries public API or dataset failures', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [endpoint, response, expected] of [
    ['http://localhost:8787/api/position', () => new Response('Network connection lost.', { status: 500 }), 2],
    ['https://tarumi-api.santanaruse.workers.dev/api/position', () => new Response('Network connection lost.', { status: 500 }), 1],
    ['http://localhost:8787/api/position', () => Response.json({ error: 'dataset_unavailable' }, { status: 503 }), 1],
  ]) {
    let count = 0; const statuses = [];
    t.mock.method(globalThis, 'fetch', async () => { count++; return response(); });
    const client = new PositionApi(() => assert.fail('Must not invent a successful response'), s => statuses.push(s), endpoint);
    client.pending = { body: { direction: 'front' }, t: 419 };
    const running = client.run(); await flushPromises(); t.mock.timers.tick(300); await running;
    assert.equal(count, expected); assert.equal(statuses.at(-1).status, 'error'); client.reset();
  }
});

test('direction reset cancels a retry waiting after a dropped local connection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0; const results = [], statuses = [];
  t.mock.method(globalThis, 'fetch', async () => { count++; return new Response('Network connection lost.', { status: 500 }); });
  const client = new PositionApi(r => results.push(r), s => statuses.push(s), LOCAL_ENDPOINT);
  t.after(() => client.reset()); client.pending = { body: { direction: 'front' }, t: 419 };
  const running = client.run(); await flushPromises(); client.reset(); t.mock.timers.tick(300); await running;
  assert.equal(count, 1); assert.equal(results.length, 0); assert.equal(statuses.some(s => s.status === 'error'), false);
});
