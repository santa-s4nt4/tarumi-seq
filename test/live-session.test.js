import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveSession } from '../src/live-session.js';

function setup(wakeLock = null, secure = true) {
  const calls = [], clears = [], statuses = [], fixes = [];
  const geolocation = { watchPosition(ok, error, options) { calls.push({ ok, error, options }); return calls.length; }, clearWatch(id) { clears.push(id); } };
  const session = new LiveSession({ geolocation, wakeLock, secure, onFix: p => fixes.push(p), onStatus: s => statuses.push(s) });
  return { session, calls, clears, statuses, fixes };
}
test('GPS starts only on request and stop ignores late fixes', async () => {
  const { session, calls, clears, statuses, fixes } = setup();
  assert.equal(calls.length, 0);
  await session.start(); await session.start();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  calls[0].ok({ timestamp: 1 }); assert.equal(fixes.length, 1);
  session.stop(); calls[0].ok({ timestamp: 2 });
  assert.equal(fixes.length, 1); assert.deepEqual(clears, [1]);
  assert.deepEqual(statuses, ['waiting', 'stopped']);
});
test('denied permission closes the watch and old callbacks cannot change a restarted session', async () => {
  const { session, calls, statuses, fixes } = setup();
  await session.start(); calls[0].error({ code: 1 });
  assert.equal(session.active, false); assert.equal(statuses.at(-1), 'denied');
  await session.start(); calls[0].ok({ old: true }); calls[0].error({ code: 1 });
  assert.equal(session.active, true); assert.equal(fixes.length, 0);
  calls[1].ok({ fresh: true }); assert.deepEqual(fixes, [{ fresh: true }]);
  session.stop();
});
test('a late wake lock is immediately released after GPS has stopped', async () => {
  let resolve, releases = 0;
  const { session } = setup({ request: () => new Promise(done => { resolve = done; }) });
  const start = session.start(); session.stop();
  resolve({ release: async () => { releases++; } }); await start;
  assert.equal(releases, 1); assert.equal(session.lock, null);
});
test('HTTP pages and unavailable geolocation fail without starting a watch', async () => {
  const insecure = setup(null, false); await insecure.session.start();
  assert.equal(insecure.calls.length, 0); assert.equal(insecure.statuses.at(-1), 'insecure');
  const statuses = [];
  const unsupported = new LiveSession({ secure: true, geolocation: null, wakeLock: null, onFix() {}, onStatus: s => statuses.push(s) });
  await unsupported.start(); assert.deepEqual(statuses, ['unsupported']);
});
