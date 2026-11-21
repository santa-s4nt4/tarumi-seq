import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { customPlan } from '../../src/journey.js';
async function seek(page,value) {await page.locator('#custom-seek').evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function centerError(page) {return page.evaluate(()=>{
  const panel=document.querySelector('.map-panel').getBoundingClientRect(), marker=document.querySelector('.current-marker').getBoundingClientRect();
  return Math.hypot(marker.x+marker.width/2-panel.x-panel.width/2,marker.y+marker.height/2-panel.y-panel.height/2);
});}
test('real terrain map centers the train, fixes view zooms, and does not oscillate in a tunnel',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/expression|layer|source|elevation/i.test(m.text()))errors.push(m.text());});
  await page.goto('/custom/?train=23&day=weekday');await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.getByRole('button',{name:'進行方向',exact:true}).click();await expect(page.locator('#map')).toHaveAttribute('data-zoom','20');
  await expect.poll(()=>centerError(page)).toBeLessThan(6);
  await seek(page,500);await expect.poll(()=>centerError(page)).toBeLessThan(6);
  await page.getByRole('button',{name:'鳥瞰',exact:true}).click();await expect(page.locator('#map')).toHaveAttribute('data-zoom','19');
  await expect.poll(()=>centerError(page)).toBeLessThan(6);
  await page.getByRole('button',{name:'自動',exact:true}).click();
  // Between 高科 and 鍋原, within tunnel country. Keep the same paused point.
  await seek(page,740);await page.waitForTimeout(3500);
  const modes=[];for(let i=0;i<8;i++){modes.push(await page.locator('#map').getAttribute('data-camera'));await page.waitForTimeout(400);}
  expect(new Set(modes).size).toBe(1);await expect.poll(()=>centerError(page)).toBeLessThan(6);
  expect(errors).toEqual([]);await page.screenshot({path:'test-results/journey-terrain.png'});
});

test('moving position follows display frames without per-frame terrain scans',async({page})=>{
  await page.goto('/custom/?train=23&day=weekday');
  await expect(page.locator('.current-marker')).toBeVisible();await seek(page,600);
  await page.locator('#custom-play').click();
  const result=await page.evaluate(async()=>{
    const resource=performance.getEntriesByType('resource').map(e=>e.name).find(name=>name.includes('/deps/mapbox-gl.js'));
    const module=await import(resource), lib=module.default??module;
    const coordinates=new Set();let terrain=0,frames=0;
    const move=lib.Marker.prototype.setLngLat, sample=lib.Map.prototype.queryTerrainElevation;
    lib.Marker.prototype.setLngLat=function(value){if(this.getElement().classList.contains('current-marker'))coordinates.add(String(value));return move.call(this,value);};
    lib.Map.prototype.queryTerrainElevation=function(...args){terrain++;return sample.apply(this,args);};
    await new Promise(resolve=>{let start;function tick(now){start??=now;frames++;if(now-start<2000)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});
    lib.Marker.prototype.setLngLat=move;lib.Map.prototype.queryTerrainElevation=sample;
    return {positions:coordinates.size,frames,terrain};
  });
  expect(result.positions).toBeGreaterThan(result.frames*.8);
  expect(result.terrain).toBeLessThan(3000);
});

for (const trainId of ['18', '23']) test(`all nine tunnels clear real terrain in both manual views and auto: train ${trainId}`, async ({page}) => {
  test.setTimeout(120000);
  const read = name => JSON.parse(fs.readFileSync(`public/data/${name}.json`));
  const plan = customPlan(read('timetable-reference'), read('railway-route'), read('stations').stations, {trainId, day:'holiday'});
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  // A short phone viewport put the old camera inside the mountain at tunnels 3 and 5.
  await page.setViewportSize({width:390,height:640});
  await page.goto(`/custom/?train=${trainId}&day=holiday`);
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.evaluate(async () => {
    const resource=performance.getEntriesByType('resource').map(e=>e.name).find(name=>name.includes('/deps/mapbox-gl.js'));
    const module=await import(resource), lib=module.default??module;
    const original=lib.Map.prototype.setFreeCameraOptions;
    lib.Map.prototype.setFreeCameraOptions=function(free) {
      window.terrainTestMap=this; window.requestedAltitude=free.position.toAltitude();
      return original.call(this,free);
    };
  });
  const times=plan.stops.map((stop,i)=>i?stop.arrivalSeconds:stop.departureSeconds);
  const seekTime=async time=>{
    const i=times.findIndex((value,index)=>index>0&&time<=value);
    await seek(page,(i-1+(time-times[i-1])/(times[i]-times[i-1]))/(times.length-1)*1000);
  };
  expect(plan.tunnels).toHaveLength(9);
  for (const tunnel of plan.tunnels) {
    for (const [mode, fractions] of [['鳥瞰',[.2,.5,.8]],['進行方向',[.5]],['自動',[.5]]]) {
      await page.getByRole('button',{name:mode,exact:true}).click();
      for (const fraction of fractions) {
        await seekTime(tunnel.entryT+(tunnel.exitT-tunnel.entryT)*fraction);
        await page.waitForTimeout(800);
        const result=await page.evaluate(()=>{
          const map=window.terrainTestMap, position=map.getFreeCameraOptions().position;
          const ground=map.queryTerrainElevation(position.toLngLat(),{exaggerated:false});
          return {correction:Math.abs(position.toAltitude()-window.requestedAltitude),clearance:ground===null?null:position.toAltitude()-ground};
        });
        expect(result.clearance,`${tunnel.name} ${mode}: DEM loaded`).not.toBeNull();
        expect(result.clearance,`${tunnel.name} ${mode}: camera above terrain`).toBeGreaterThan(19);
        expect(result.correction,`${tunnel.name} ${mode}: no Mapbox collision clamp`).toBeLessThan(1);
        expect(await centerError(page),`${tunnel.name} ${mode}: centered train`).toBeLessThan(6);
      }
    }
    await expect(page.locator('#map')).toHaveAttribute('data-camera','bird');
    const portals=page.locator(`.tunnel-marker[data-tunnel="${tunnel.id}"]`);
    await expect(portals).toHaveCount(2);
    await expect(portals.locator('.tunnel-marker-label:visible')).toHaveCount(1);
    // The entrance moves to the opposite end for a train travelling south.
    await expect(portals.first()).toHaveAttribute('data-target',plan.train.direction==='front'?'entrance':'exit');
  }
  expect(errors).toEqual([]);
});
