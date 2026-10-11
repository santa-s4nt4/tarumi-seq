import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeBearing, routeLookahead, turnTowards, terrainClearance, terrainOccludesPosition, OcclusionCamera, cameraChanges } from '../src/camera.js';

const north = [{ t: 0, lat: 35, lon: 136 }, { t: 1, lat: 35, lon: 136 }, { t: 2, lat: 35.001, lon: 136 }];
test('camera faces down the track, including station dwell and the record endpoint', () => {
  assert.equal(routeBearing(north, 0), 0);
  assert.equal(routeBearing(north, 2), 0);
  const south = north.map(r => ({ ...r, lat: 70 - r.lat }));
  assert.equal(Math.abs(routeBearing(south, 0)), 180);
  assert.equal(routeBearing([{ t: 0, lat: 35, lon: 136 }, { t: 1, lat: 35, lon: 136.001 }], 0), 90);
});
test('camera turns across north by the short path and holds a stationary direction', () => {
  assert.equal(turnTowards(179, -179, 0.5), -180);
  assert.equal(turnTowards(45, 45), 45);
  assert.equal(routeBearing(north.slice(0, 2), 0), 0);
});

test('lookahead spans a fixed track distance through dwell and curves, without crossing GPS gaps', () => {
  const track = [{ t: 0, lat: 35, lon: 136 }, { t: 1, lat: 35, lon: 136 },
    { t: 2, lat: 35.001, lon: 136 }, { t: 3, lat: 35.001, lon: 136.001 }];
  const positions = routeLookahead(track, 0, 120, 30);
  assert.equal(positions.length, 4);
  assert.ok(positions[0].t > 1);
  assert.equal(positions[2].lon, 136);
  assert.equal(positions[3].lat, 35.001);
  assert.ok(positions[3].lon > 136);
  assert.deepEqual(routeLookahead([{ ...track[0] }, { ...track[2], t: 10 }], 0), []);
  assert.deepEqual(routeLookahead(track, 3), []);
});

test('normal viewpoint distinguishes foreground hills from clear or missing terrain', () => {
  const options = { center: { lat: 35, lon: 136 }, bearing: 0, radius: 600 };
  assert.equal(terrainOccludesPosition({ ...options, sampleElevation: () => 100 }), false);
  assert.equal(terrainOccludesPosition({ ...options, sampleElevation: () => null }), null);
  assert.equal(terrainOccludesPosition({ ...options, sampleElevation: (lon, lat) => 100 + Math.max(0, (35 - lat) * 111195) }), true);
});

test('clearance uses the saved normal camera and requires all of its terrain samples', () => {
  const options = { center: { lat: 35, lon: 136 }, bearing: 0, horizontal: 600, vertical: 200 };
  assert.ok(terrainClearance({ ...options, sampleElevation: () => 100 }) < -6);
  assert.ok(terrainClearance({ ...options, sampleElevation: (lon, lat) => 100 + Math.max(0, (35 - lat) * 111195) }) > 0);
  assert.equal(terrainClearance({ ...options, sampleElevation: (lon, lat) => lat < 34.999 ? null : 100 }), null);
});

test('rail elevation below the local terrain keeps the automatic camera in bird view', () => {
  const options = { center: { lat: 35, lon: 136 }, bearing: 0, horizontal: 600, vertical: 200,
    sampleElevation: () => 160 };
  assert.ok(terrainClearance({ ...options, targetElevation: 120 }) > 0);
  assert.ok(terrainClearance({ ...options, targetElevation: 162 }) < -6);
});

test('bird mode eases both zoom and pitch in half a second, then returns without rapid toggles', () => {
  const camera = new OcclusionCamera({ clearDelay: 200 });
  assert.deepEqual(camera.update(true, 0), { pitch: 72, zoom: 17 });
  assert.deepEqual(camera.update(true, 250), { pitch: 36, zoom: 18 });
  assert.deepEqual(camera.update(true, 500), { pitch: 0, zoom: 19 });
  assert.deepEqual(camera.update(false, 600), { pitch: 0, zoom: 19 });
  assert.deepEqual(camera.update(true, 700), { pitch: 0, zoom: 19 });
  camera.update(false, 1000);
  assert.deepEqual(camera.update(false, 1200), { pitch: 0, zoom: 19 });
  assert.deepEqual(camera.update(false, 1450), { pitch: 36, zoom: 18 });
  assert.deepEqual(camera.update(false, 1700), { pitch: 72, zoom: 17 });
});

test('view transitions continue from their current angle when interrupted or reset by a seek', () => {
  const camera = new OcclusionCamera({ clearDelay: 200 });
  camera.update(true, 0);
  assert.deepEqual(camera.update(false, 500), { pitch: 0, zoom: 19 });
  camera.update(false, 700);
  assert.deepEqual(camera.update(true, 950), { pitch: 36, zoom: 18 });
  assert.deepEqual(camera.update(true, 1200), { pitch: 18, zoom: 18.5 });
  camera.reset(1200);
  assert.deepEqual(camera.update(null, 1450), { pitch: 45, zoom: 17.75 });
  assert.deepEqual(camera.update(false, 1700), { pitch: 72, zoom: 17 });
});

test('missing DEM and short clear flickers do not switch the camera back into a hill', () => {
  const camera = new OcclusionCamera();
  camera.update(true, 0);
  camera.update(false, 500);
  camera.update(null, 700);
  assert.deepEqual(camera.update(null, 12000), { pitch: 0, zoom: 19 });
  camera.update(false, 12100);
  camera.update(true, 12400);
  assert.deepEqual(camera.update(false, 12500), { pitch: 0, zoom: 19 });
  camera.update(false, 12850);
  assert.deepEqual(camera.update(false, 13100), { pitch: 36, zoom: 18 });
  assert.deepEqual(camera.update(false, 13350), { pitch: 72, zoom: 17 });
});

test('zoom buttons change the active mode smoothly and preserve the bird mode', () => {
  const camera = new OcclusionCamera();
  camera.setZooms(16, 18, 0);
  assert.deepEqual(camera.valueAt(250), { pitch: 72, zoom: 16.5 });
  camera.update(true, 500);
  assert.deepEqual(camera.update(true, 1000), { pitch: 0, zoom: 18 });
  camera.setZooms(16.5, 19.5, 1000);
  assert.deepEqual(camera.update(true, 1250), { pitch: 0, zoom: 18.75 });
  assert.deepEqual(camera.update(true, 1500), { pitch: 0, zoom: 19.5 });
});

test('fixed views ignore terrain changes, preserve their mode on seek and return to automatic on request', () => {
  const camera = new OcclusionCamera();
  camera.setMode('bird', 0);
  assert.deepEqual(camera.update(false, 250), { pitch: 36, zoom: 18 });
  assert.deepEqual(camera.update(false, 500), { pitch: 0, zoom: 19 });
  camera.reset(600);
  assert.deepEqual(camera.update(false, 1200), { pitch: 0, zoom: 19 });
  camera.setMode('normal', 1200);
  assert.deepEqual(camera.update(true, 1700), { pitch: 72, zoom: 17 });
  assert.deepEqual(camera.update(true, 3000), { pitch: 72, zoom: 17 });
  camera.setMode('auto', 3000);
  camera.update(true, 3000);
  assert.deepEqual(camera.update(true, 3500), { pitch: 0, zoom: 19 });
});

test('follow changes do not repeatedly restore a terrain-constrained zoom or pitch', () => {
  const camera = { center: [136, 35], zoom: 17, pitch: 72, bearing: 0 };
  assert.deepEqual(cameraChanges(camera, camera), {});
  assert.deepEqual(cameraChanges(camera, { ...camera, center: [136, 35.001] }), { center: [136, 35.001] });
  assert.deepEqual(cameraChanges(camera, { ...camera, bearing: 1 }), { bearing: 1 });
  assert.deepEqual(cameraChanges(camera, { ...camera, zoom: 18, pitch: 36 }), { zoom: 18, pitch: 36 });
});
