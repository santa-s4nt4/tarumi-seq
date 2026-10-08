import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolatePrediction } from '../src/interpolate.js';

const nodes = [[0, 0, 0, 0], [0, 100, 100, 10], [0, 200, 200, 20]];
const event = (id, type, eta, d, extra = {}) => ({ id, type, etaSeconds: eta, distanceMeters: d, ...extra });
const response = {
  position: { inTunnel: false, tunnelId: null }, river: { signedDistanceMeters: 20 },
  upcoming: [event('first', 'station', 3, 30), event('entrance', 'tunnel', 5, 50, { featureId: 't1', target: 'entrance' }), event('exit', 'tunnel', 8, 80, { featureId: 't1', target: 'exit' }), event('second', 'station', 15, 150)],
};
test('uses playback elapsed time for ETA and GPS distance for metres without mutating the API result', () => {
  const frozen = JSON.stringify(response);
  const r = interpolatePrediction(response, 0, 2, nodes, [[20, 0], [20, 200]], true);
  assert.equal(r.next.station.etaSeconds, 1); assert.equal(r.next.station.distanceMeters, 10);
  assert.equal(r.river.signedDistanceMeters, 20); assert.equal(JSON.stringify(response), frozen);
  assert.equal(interpolatePrediction(response, 0, 0, nodes, [], true), response);
});
test('promotes upcoming events and transitions through tunnel entrance and exit between requests', () => {
  const r = interpolatePrediction(response, 0, 6, nodes, [], false);
  assert.equal(r.next.station.id, 'second'); assert.equal(r.next.station.etaSeconds, 9);
  assert.equal(r.position.inTunnel, true); assert.equal(r.next.tunnel.target, 'exit');
  const after = interpolatePrediction(response, 0, 9, nodes, [], false);
  assert.equal(after.position.inTunnel, false); assert.equal(after.next.tunnel, null);
  assert.equal(interpolatePrediction(response, 0, 20, nodes, [], false).next.station, null);
});
test('does not advance countdown when playback is paused or borrow river geometry from a mismatched dataset', () => {
  const first = interpolatePrediction(response, 0, 2, nodes, [[-30, 0], [-30, 200]], false);
  const paused = interpolatePrediction(response, 0, 2, nodes, [[-30, 0], [-30, 200]], false);
  assert.equal(first.next.station.etaSeconds, paused.next.station.etaSeconds);
  assert.equal(first.river.signedDistanceMeters, 20); assert.equal(first.viewerPrediction.riverEstimated, false);
});

test('keeps arrived station at zero through dwell, then advances after departure', () => {
 const route=[[0,0,0,0,36],[0,100,100,10,0],[0,100,100,30,0],[0,200,200,40,36]];
 const r={position:{},river:{},upcoming:[event('stop','station',10,100,{target:'arrival',departureDistanceMeters:100,departureEtaSeconds:30}),event('next','station',40,200)]};
 const stopped=interpolatePrediction(r,0,20,route,[],false);
 assert.equal(stopped.next.station.id,'stop');assert.equal(stopped.next.station.etaSeconds,0);assert.equal(stopped.position.speedKmh,0);
 assert.equal(interpolatePrediction(r,0,35,route,[],false).next.station.id,'next');
});
