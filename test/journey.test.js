import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activeServices, services, servesExperienceSection, StationRange, customPlan, customTimetable, nearestRun } from '../src/journey.js';
import { JourneyCamera, cameraRadius, cameraEye, terrainSafeRadius } from '../src/journey-camera.js';
import { LiveTimetable } from '../src/live-timetable.js';
import { createRailProfile } from '../src/rail-elevation.js';
import { positionAlong, serviceSeconds } from '../src/simulation.js';
const read = name => JSON.parse(fs.readFileSync(`public/data/${name}.json`));
const timetable=read('timetable-reference'), railway=read('railway-route'), stations=read('stations').stations;

test('LIVE availability includes service boundaries and respects holidays', () => {
  assert.deepEqual(activeServices(timetable, Date.parse('2026-11-20T03:00:00+09:00')), []);
  for(const day of ['weekday','holiday']) for(const direction of ['front','back']) {
    const choices=services(timetable,direction,day);
    assert(choices.length>0);
    assert(choices.every(t=>t.direction===direction && (day==='holiday'||t.operatingDays==='daily')));
  }
  const train=services(timetable,'front','weekday')[0];
  const now=Date.parse(`2026-11-20T${train.stops[0].departure}:00+09:00`);
  assert(!activeServices(timetable,now-1).some(t=>t.id===train.id));
  assert(activeServices(timetable,now).some(t=>t.id===train.id));
});

test('only the 22 Motosu–Tarumi services can be selected, including through services from Ogaki', () => {
  const expected = read('timetable').trains.map(train => train.id).sort();
  for (const day of ['weekday', 'holiday']) {
    assert.deepEqual(['front', 'back'].flatMap(direction => services(timetable, direction, day).map(train => train.id)).sort(), expected);
  }
  for (const date of ['2026-11-20', '2026-11-21']) for (let minute = 0; minute < 1440; minute++) {
    const now = Date.parse(`${date}T00:00:00+09:00`) + minute * 60000;
    assert(activeServices(timetable, now).every(train => expected.includes(train.id)));
  }
  for (const train of timetable.trains.filter(train => !expected.includes(train.id))) {
    assert.throws(() => customPlan(timetable, railway, stations, { trainId: train.id, day: 'holiday' }));
  }
});

test('CUSTOM uses the diagram’s Motosu–Tarumi times for all 22 trains without changing LIVE', () => {
  const original = structuredClone(timetable), diagram = read('timetable');
  assert.deepEqual(customTimetable(timetable).trains, diagram.trains);
  for (const day of ['weekday', 'holiday']) for (const train of diagram.trains) {
    const plan = customPlan(timetable, railway, stations, { trainId: train.id, day });
    assert.deepEqual(plan.train.stops, train.stops);
    assert.equal(plan.start, serviceSeconds(train.stops[0].departure));
    assert.equal(plan.end, serviceSeconds(train.stops.at(-1).arrival));
    assert.equal(plan.stops.length, 11);
    assert.equal(plan.stops.at(-1).departureSeconds, null);
    assert.equal(plan.tunnels.length, 9);
  }
  assert.deepEqual(timetable, original);
});

test('CUSTOM handles eligible trains and station ranges in both travel directions', () => {
  for(const train of timetable.trains.filter(servesExperienceSection)) {
    const plan=customPlan(timetable,railway,stations,{trainId:train.id,day:'holiday'});
    const range=new StationRange(plan.stops);
    const oldRange = new StationRange(plan.stops, train.direction === 'front' ? 1 : 19, train.direction === 'front' ? 19 : 1);
    assert.equal(oldRange.start, plan.start); assert.equal(oldRange.end, plan.end);
    assert.equal(range.start,plan.start); assert.equal(range.end,plan.end);
    range.set('in',999); assert.equal(range.first,range.last-1);
    range.set('out',-999); assert.equal(range.last,range.first+1);
    assert.equal(range.clamp(-Infinity),range.start); assert.equal(range.clamp(Infinity),range.end);
    assert(range.contains(plan.events.find(e=>e.type==='station'&&e.globalS===plan.stops[range.last].s)));
    const restored=new StationRange(plan.stops,plan.stops[range.first].station,plan.stops[range.last].station);
    assert.equal(restored.start,range.start); assert.equal(restored.end,range.end);
  }
});

test('automatic view has sustained occlusion hysteresis and ignores unavailable terrain', () => {
  const camera=new JourneyCamera();
  camera.decide(true,0); camera.decide(true,599); assert.equal(camera.targetBird,false);
  camera.decide(true,600); assert.equal(camera.targetBird,true);
  for(let t=700;t<10000;t+=100) camera.decide(t%200===0?false:true,t);
  assert.equal(camera.targetBird,true);
  camera.decide(false,10000); camera.decide(false,12999); assert.equal(camera.targetBird,true);
  camera.decide(null,13000); camera.decide(false,14000); camera.decide(false,17000); assert.equal(camera.targetBird,false);
  camera.setMode('bird'); camera.decide(null,17100); assert.equal(camera.targetBird,true);
  camera.setMode('normal'); camera.decide(true,17200); assert.equal(camera.targetBird,false);
  assert.equal(cameraRadius(35,800,19),cameraRadius(35,800,20)*2);
});

test('performance selects only an unambiguous fresh fix on the railway', () => {
  const fleet=new LiveTimetable(timetable,railway,stations), now=Date.parse('2026-11-20T15:30:00+09:00');
  const {active}=fleet.at(now), run=active.find(r=>r.train.id==='23'), profile=createRailProfile(railway);
  const p=positionAlong(run,run.secondsAt(now)), [longitude,latitude]=profile.coordinateAt(p.s);
  const fix={timestamp:now,coords:{longitude,latitude,accuracy:5}};
  assert.equal(nearestRun([run],profile,fix,now),run);
  assert.equal(nearestRun([run,run],profile,fix,now),null);
  assert.equal(nearestRun([run],profile,{...fix,timestamp:now-20000},now),null);
  assert.equal(nearestRun([run],profile,{...fix,coords:{...fix.coords,latitude:35}},now),null);
});

test('camera tracks every frame while terrain checks stay bounded, including after a seek', () => {
  const camera=new JourneyCamera(), profile=createRailProfile(railway);
  let queries=0;
  const sampleElevation=()=>{queries++;return 0;};
  const centers=new Set();
  for(let frame=0;frame<60;frame++) {
    const view=camera.at({profile,s:1000+frame,direction:'front',height:800,sampleElevation,now:frame*1000/60});
    centers.add(view.center.join(','));
  }
  assert.equal(centers.size,60);
  assert(queries<=6*225,`terrain queries were ${queries}, expected at most six checks in one second`);
  const before=queries;camera.reset();camera.at({profile,s:15000,direction:'front',height:800,sampleElevation,now:990});
  assert(queries>before,'a seek must not reuse the old terrain result');
  camera.setMode('normal');const fixed=queries;
  camera.at({profile,s:15001,direction:'front',height:800,sampleElevation,now:1100});
  assert(queries-fixed<=5,'manual views check camera clearance without scanning all occlusion rays');
});

test('camera keeps its nominal distance on open track but clears deep terrain at every pitch', () => {
  const center=[136.62,35.63],elevation=165;
  for(const height of [250,450,800]) for(const pitch of [0,15,35,55,68]) {
    const view={center,elevation,pitch,bearing:180}, nominal=cameraRadius(center[1],height,pitch===0?19:20);
    assert.equal(terrainSafeRadius(view,nominal,()=>0),nominal);
    assert.equal(terrainSafeRadius(view,nominal,()=>null),nominal);
    const ground=330, radius=terrainSafeRadius(view,nominal,()=>ground);
    assert(cameraEye(view,radius).altitude>=ground+20-0.01);
    assert(radius>=nominal);
  }
});

test('all tunnel runs remain above a mountain in both directions and all camera modes', () => {
  const profile=createRailProfile(railway),ground=400;
  for(const direction of ['front','back']) for(const mode of ['auto','normal','bird']) for(const tunnel of railway.tunnels) {
    const camera=new JourneyCamera();camera.setMode(mode);
    for(let frame=0;frame<90;frame++) {
      const fraction=direction==='front'?frame/89:1-frame/89,s=tunnel.start+(tunnel.end-tunnel.start)*fraction;
      const view=camera.at({profile,s,direction,height:300,sampleElevation:()=>ground,now:frame*1000/60});
      const eye=cameraEye(view,view.radius);
      assert(eye.altitude>=ground+20-0.01,`${tunnel.name} ${direction} ${mode} camera entered terrain`);
      assert(view.radius<2500,'terrain clearance must not create an unbounded orbit');
    }
  }
});

test('automatic view anticipates a tunnel even before its DEM is available', () => {
  const profile=createRailProfile(railway),tunnel=railway.tunnels.at(-1);
  for(const direction of ['front','back']) {
    const camera=new JourneyCamera(),s=direction==='front'?tunnel.start-150:tunnel.end+150;
    for(let now=0;now<=1000;now+=100) camera.at({profile,s,direction,height:450,sampleElevation:()=>null,now,elapsed:100});
    assert.equal(camera.targetBird,true);
  }
});
