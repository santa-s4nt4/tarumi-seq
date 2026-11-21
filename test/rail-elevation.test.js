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

test('all tunnel map intervals match the recorded OSM portal coordinates', () => {
  const rows=fs.readFileSync('public/data/tarumi_tunnels.csv','utf8').trim().replace(/^\uFEFF/,'').split(/\r?\n/).slice(1);
  assert.equal(railway.tunnels.length,rows.length);
  for(const row of rows) {
    const [,id,,entryLat,entryLon,exitLat,exitLon]=row.split(',');
    const tunnel=railway.tunnels.find(item=>item.id===`tunnel-${id}`);
    assert(tunnel);
    assert(Math.abs(profile.project(Number(entryLon),Number(entryLat)).s-tunnel.start)<1);
    assert(Math.abs(profile.project(Number(exitLon),Number(exitLat)).s-tunnel.end)<1);
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

test('every mapped Neo River crossing falls inside its bridge segment', () => {
  const river=JSON.parse(fs.readFileSync('public/data/map-data.json')).front.river;
  const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
  let crossings=0;
  for(let i=1;i<railway.coordinates.length;i++) {
    const a=railway.coordinates[i-1], b=railway.coordinates[i], r=[b[0]-a[0],b[1]-a[1]];
    for(let j=1;j<river.length;j++) {
      const c=river[j-1],d=river[j],s=[d[0]-c[0],d[1]-c[1]],delta=[c[0]-a[0],c[1]-a[1]],den=cross(r,s);
      if(Math.abs(den)<1e-15)continue;
      const t=cross(delta,s)/den,u=cross(delta,r)/den;
      if(t<0||t>1||u<0||u>1)continue;
      crossings++;
      const at=profile.project(a[0]+t*r[0],a[1]+t*r[1]).s;
      assert(railway.bridges.some(bridge=>at>=bridge.start-2&&at<=bridge.end+2),`crossing at ${at}m has no bridge`);
    }
  }
  assert(crossings>=10);
});

test('cached line progress preserves both route endpoints and advances through curved sections', async () => {
  const {createLineProgress}=await import('../src/rail-elevation.js');
  const progress=createLineProgress(profile);
  assert.equal(progress(-1),0);assert.equal(progress(0),0);assert.equal(progress(profile.maxS),1);assert.equal(progress(Infinity),1);
  let previous=0;
  for(let s=100;s<profile.maxS;s+=100) {
    const next=progress(s);assert(next>previous&&next<1);assert(Math.abs(next-s/profile.maxS)<0.001);previous=next;
  }
});
