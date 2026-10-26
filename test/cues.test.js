import test from 'node:test';
import assert from 'node:assert/strict';
import { CueQueue } from '../src/cues.js';

const station = (id, eta) => ({ id, name: id, type: 'station', target: 'arrival', etaSeconds: eta });
const tunnel = (id, target, eta) => ({ id: `${id}-${target}`, featureId: id, name: id, type: 'tunnel', target, etaSeconds: eta });
const prediction = (events, tunnelId = null) => ({ next: { station: events.find(event => event.type === 'station') }, upcoming: events,
  position: { inTunnel: Boolean(tunnelId), tunnelId } });

test('orders station and distinct tunnel checkpoints together, then promotes the next event', () => {
  const queue = new CueQueue();
  const events = [station('A', 30), tunnel('T1', 'entrance', 10), tunnel('T1', 'exit', 20), tunnel('T2', 'entrance', 40), tunnel('T2', 'exit', 50), station('B', 60)];
  const before = JSON.stringify(events);
  const cards = queue.cards(prediction(events));
  assert.deepEqual(cards.map(event => event.id), ['T1-entrance', 'A', 'T2-entrance']);
  assert.deepEqual(queue.cards(prediction(events.filter(event => event.featureId !== 'T1'))).map(event => event.id), ['A', 'T2-entrance', 'B']);
  assert.equal(JSON.stringify(events), before);
});

test('keeps one tunnel identity while switching its card from entrance to passage', () => {
  const queue = new CueQueue(), events = [tunnel('T1', 'entrance', 0), tunnel('T1', 'exit', 20), station('A', 30)];
  const outside = queue.cards(prediction(events)), inside = queue.cards(prediction(events, 'T1'));
  assert.equal(outside[0].key, inside[0].key);
  assert.equal(outside[0].target, 'entrance');
  assert.equal(inside[0].target, 'exit');
  assert.equal(inside.filter(event => event.featureId === 'T1').length, 1);
});

test('holds every other countdown during station dwell, including fresh API responses, and resumes after departure', () => {
  const queue = new CueQueue();
  queue.cards(prediction([station('A', 0), tunnel('T1', 'entrance', 60), tunnel('T1', 'exit', 80), station('B', 100)]));
  queue.cards(null);
  const stopped = queue.cards(prediction([station('A', 0), tunnel('T1', 'entrance', 45), tunnel('T1', 'exit', 65), station('B', 85)]));
  assert.deepEqual(stopped.map(event => event.etaSeconds), [0, 60, 100]);
  const moving = queue.cards(prediction([tunnel('T1', 'entrance', 40), tunnel('T1', 'exit', 60), station('B', 80)]));
  assert.deepEqual(moving.map(event => event.etaSeconds), [40, 80]);
  assert.equal(queue.stopId, null);
  queue.cards(prediction([station('A', 0), station('B', 20)]));
  queue.reset();
  assert.equal(queue.cards(prediction([station('A', 0), station('B', 10)]))[1].etaSeconds, 10);
});

test('does not freeze a fractional final second before a station has arrived', () => {
  const queue = new CueQueue();
  const approach = eta => prediction([station('A', eta), station('B', eta + 30)]);
  assert.equal(queue.cards(approach(0.49))[0].etaSeconds, 0.49);
  assert.equal(queue.stopId, null);
  assert.equal(queue.cards(approach(0.1))[0].etaSeconds, 0.1);
  assert.equal(queue.stopId, null);
  assert.deepEqual(queue.cards(approach(0)).map(event => event.etaSeconds), [0, 30]);
  assert.deepEqual(queue.cards(prediction([station('A', 0), station('B', 25)])).map(event => event.etaSeconds), [0, 30]);
});

test('an explicit arrival sets its own ETA to zero rather than freezing a positive value', () => {
  const queue = new CueQueue();
  const cards = queue.cards(prediction([{ ...station('A', 0.3), arrived: true }, station('B', 30)]));
  assert.equal(cards[0].etaSeconds, 0);
  assert.equal(cards[0].arrived, true);
});
