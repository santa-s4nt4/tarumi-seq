import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRailProfile, elevatedLineFeature, railElevationAt, railLineZOffset } from '../src/rail-elevation.js';

const railway = JSON.parse(fs.readFileSync(new URL('../public/data/railway-route.json', import.meta.url)));
const profile = createRailProfile(railway);

test('station-ground anchors form a continuous moderate railway grade through the tunnel country', () => {
  assert.equal(railway.elevationAnchors.length, 19);
  const motosu = railway.elevationAnchors.find(anchor => anchor.order === 9);
  const tarumi = railway.elevationAnchors.find(anchor => anchor.order === 19);
  assert.equal(motosu.meters, 38.7);
  assert.equal(tarumi.meters, 168.4);
  for (let i = 1; i < railway.elevationAnchors.length; i++) {
    const a = railway.elevationAnchors[i - 1], b = railway.elevationAnchors[i];
    assert.ok(b.s > a.s);
    assert.ok(Math.abs((b.meters - a.meters) / (b.s - a.s)) < 0.02);
    assert.equal(railElevationAt(railway, a.s), a.meters);
    assert.ok(Math.abs(railElevationAt(railway, (a.s + b.s) / 2) - (a.meters + b.meters) / 2) < 1e-9);
  }
  for (const tunnel of railway.tunnels) {
    const z0 = profile.elevationAt(tunnel.start), z1 = profile.elevationAt(tunnel.end);
    assert.ok(Math.abs(z1 - z0) < (tunnel.end - tunnel.start) * 0.02);
  }
});

test('OSM bridge ways stay on the mainline and can be cut into elevated map features', () => {
  const motosuS = railway.stations.find(station => station.order === 9).s;
  assert.ok(railway.bridges.length >= 20);
  assert.ok(railway.bridges.filter(bridge => bridge.start >= motosuS).length >= 15);
  for (const bridge of railway.bridges) {
    assert.ok(bridge.id.startsWith('bridge-'));
    assert.ok(bridge.start >= 0 && bridge.end > bridge.start && bridge.end <= profile.maxS);
    const section = profile.section(bridge.start, bridge.end);
    assert.ok(section.length >= 2);
    assert.ok(profile.project(...section[0]).offsetMeters < 0.01);
    assert.ok(profile.project(...section.at(-1)).offsetMeters < 0.01);
    const feature = elevatedLineFeature(profile, section);
    assert.equal(feature.geometry.type, 'LineString');
    assert.ok(feature.properties.elevation.length >= 2);
    assert.ok(Math.abs(feature.properties.elevation[0] - profile.elevationAt(bridge.start)) < 0.11);
  }
});

test('projection and equal-distance elevation samples support both travel directions and distant seeks', () => {
  const motosu = railway.stations.find(station => station.order === 9);
  const tarumi = railway.stations.find(station => station.order === 19);
  const spot = profile.project(motosu.lon, motosu.lat);
  assert.ok(Math.abs(spot.s - motosu.s) < 0.01);
  assert.ok(spot.offsetMeters < 0.01);
  assert.ok(Math.abs(spot.elevationMeters - 38.7) < 1e-9);
  assert.ok(Math.abs(profile.project(motosu.lon, motosu.lat, tarumi.s).s - motosu.s) < 0.01);
  const north = profile.section(motosu.s, tarumi.s);
  const south = profile.section(tarumi.s, motosu.s);
  assert.deepEqual(north[0], south.at(-1));
  assert.deepEqual(north.at(-1), south[0]);
  const feature = elevatedLineFeature(profile, north);
  assert.equal(feature.properties.elevation[0], 38.7);
  assert.equal(feature.properties.elevation.at(-1), 168.4);
  assert.equal(elevatedLineFeature(profile, south).properties.elevation[0], 168.4);
  assert.equal(railLineZOffset[0], 'at-interpolated');
});
