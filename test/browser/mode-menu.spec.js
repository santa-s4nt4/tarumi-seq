import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { activeServices } from '../../src/journey.js';
const fixed=new Date('2026-11-21T10:34:00+09:00');
const timetable=JSON.parse(fs.readFileSync('public/data/timetable-reference.json'));
const custom='/custom/?train=18&day=holiday&from=19&to=10';
async function load(page,path='/') { await page.goto(path);await expect(page.locator('#loading')).toBeHidden(); }

async function checkOverviewNames(page, selector, mobile) {
  const labels=await page.locator(selector).evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().width).map(node=>{
    const rect=node.getBoundingClientRect(), roman=node.querySelector('.station-romaji');
    return {station:Number(node.parentNode.dataset.station),font:parseFloat(getComputedStyle(node).fontSize),
      roman:getComputedStyle(roman).display,romaji:roman.textContent,x:rect.x,y:rect.y,width:rect.width,height:rect.height};
  }));
  expect(labels).toHaveLength(11);
  const regular=labels.find(label=>label.station===10);
  if (mobile) {
    expect(regular.font).toBeLessThan(16);
    expect(labels.every(label=>label.font===regular.font)).toBe(true);
  } else {
    expect(labels.find(label=>label.station===9).font).toBeGreaterThan(regular.font);
    expect(labels.find(label=>label.station===19).font).toBeGreaterThan(regular.font);
  }
  expect(labels.find(label=>label.station===18).romaji).toBe('Midori');
  for(const label of labels) {
    expect(label.roman).toBe(mobile?'none':'inline');
    expect(label.x).toBeGreaterThanOrEqual(0);
  }
  for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) {
    const a=labels[i],b=labels[j];
    expect(a.x>=b.x+b.width||b.x>=a.x+a.width||a.y>=b.y+b.height||b.y>=a.y+a.height,`station names ${a.station} and ${b.station} overlap`).toBe(true);
  }
}

test('both menus exclude trains that only run between Ogaki and Motosu, including old direct links',async({page})=>{
  await page.route('https://*.mapbox.com/**',route=>route.abort());
  await page.clock.setFixedTime(new Date('2026-11-21T07:25:00+09:00'));
  await load(page,'/live/?train=8');
  await expect(page.locator('#mode-menu')).toBeVisible();
  expect(await page.locator('#menu-trains [role=option]').evaluateAll(nodes=>nodes.map(node=>node.dataset.train))).toEqual(['5','10']);
  const spaceAfterLastOption = list => list.evaluate(node =>
    node.getBoundingClientRect().bottom - node.lastElementChild.getBoundingClientRect().bottom);
  expect(await spaceAfterLastOption(page.locator('#menu-trains'))).toBeLessThanOrEqual(1);
  await load(page,'/custom/?train=1001&day=holiday');
  await expect(page.locator('#mode-menu')).toBeVisible();
  await expect(page.locator('#custom-timeline')).toBeHidden();
  const section=JSON.parse(fs.readFileSync('public/data/timetable.json'));
  for(const day of ['weekday','holiday']) for(const direction of ['front','back']) {
    await page.locator(`input[name=day][value=${day}]`).check();
    await page.locator(`input[name=direction][value=${direction}]`).check();
    const ids=await page.locator('#custom-service [role=option]').evaluateAll(nodes=>nodes.map(node=>node.dataset.train));
    expect(ids).toEqual(section.trains.filter(train=>train.direction===direction).map(train=>train.id));
    await expect(page.locator('#custom-service [role=option]')).toHaveText(section.trains.filter(train=>train.direction===direction)
      .map(train=>`${direction==='front'?'本巣':'樽見'}発　${train.stops[0].departure}–${train.stops.at(-1).arrival}`));
    expect(await spaceAfterLastOption(page.locator('#custom-service'))).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole('radio',{name:'本巣行き',exact:true})).toBeVisible();
});

test('LIVE lists every active train and confirms explicitly; CUSTOM is a scrollable keyboard-selectable list',async({page})=>{
  await page.route('https://*.mapbox.com/**',route=>route.abort());await page.clock.setFixedTime(fixed);
  await page.setViewportSize({width:390,height:844});await load(page);
  expect(await page.locator('.mode-tabs').evaluate(node=>getComputedStyle(node).outlineStyle)).toBe('none');
  await expect(page.getByRole('button',{name:'メニューを閉じる'})).toBeHidden();
  await page.keyboard.press('Escape');await expect(page.locator('#mode-menu')).toBeVisible();
  const choices=page.locator('#menu-trains [role=option]');
  await expect(choices).toHaveCount(activeServices(timetable,+fixed).length);
  await expect(page.locator('#mode-live .mode-confirm')).toBeDisabled();
  await choices.last().click();await expect(choices.last()).toHaveAttribute('aria-selected','true');await expect(page).toHaveURL(/\/$/);
  await page.getByRole('tab',{name:'CUSTOM'}).click();await expect(page.locator('#mode-live')).toBeHidden();
  const tabs=await page.locator('[role=tab]').evaluateAll(nodes=>nodes.map(node=>({
    selected:node.getAttribute('aria-selected'),border:getComputedStyle(node).borderBottomColor,background:getComputedStyle(node).backgroundColor,
  })));
  expect(tabs[0].border).toBe('rgba(0, 0, 0, 0)');expect(tabs[1].border).toBe('rgb(0, 255, 54)');
  expect(tabs.every(tab=>tab.background==='rgba(0, 0, 0, 0)')).toBe(true);
  await expect(page.locator('#custom-service select')).toHaveCount(0);
  const list=page.locator('#custom-service');expect(await list.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  await list.locator('[role=option]').first().focus();await page.keyboard.press('End');
  await expect(list.locator('[role=option]').last()).toHaveAttribute('aria-selected','true');
  expect(await list.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('tab',{name:'LIVE',exact:true}).click();await expect(choices.last()).toHaveAttribute('aria-selected','true');
  const chosen=await choices.last().getAttribute('data-train');await page.locator('#mode-live .mode-confirm').click();
  await expect(page).toHaveURL(new RegExp('/live/\\?train='+chosen+'$'));
});

for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:640}]) test(`menu preserves the selected train, time, view and playback at ${viewport.width}px`,async({page})=>{
  await page.route('https://*.mapbox.com/**',route=>route.abort());await page.clock.setFixedTime(fixed);await page.setViewportSize(viewport);await load(page,custom);
  await page.getByRole('button',{name:'鳥瞰',exact:true}).click();await page.locator('#custom-play').click();
  await expect(page.locator('#journey-clock')).toHaveText('10:33:01');await page.getByRole('button',{name:'メニューを開く'}).click();
  const time=await page.locator('#journey-clock').textContent();await page.waitForTimeout(2200);
  await expect(page.locator('#journey-clock')).toHaveText(time);await expect(page.locator('#journey-clock')).toBeVisible();
  await expect(page.locator('#journey-speed')).toBeHidden();await expect(page.locator('#custom-timeline')).toBeHidden();await expect(page.locator('.cue-overlay')).toBeHidden();
  await expect(page.locator('#line-map .line-train:not([hidden])')).toHaveCount(1);
  await expect(page.locator('#line-map .line-train:not([hidden])')).toHaveAttribute('data-train','18');
  await expect(page.locator('#line-map .line-train:not([hidden])')).toHaveText('樽見発 10:33–11:04');
  await expect(page.locator('#line-map .line-river')).toBeHidden();await expect(page.locator('#line-map .line-track')).toBeHidden();
  await expect(page.locator('#line-map .line-overview-river')).toBeVisible();
  await checkOverviewNames(page,'#line-map [data-station] text',viewport.width<=760);
  const visible=await page.locator('#line-map [data-station]').evaluateAll(nodes=>nodes.filter(e=>getComputedStyle(e).display!=='none').map(e=>Number(e.dataset.station)));
  expect(visible).toEqual([9,10,11,12,13,14,15,16,17,18,19]);
  const rect=await page.locator('#mode-menu').boundingBox();
  if(viewport.width>760) {expect(rect.x+rect.width).toBe(viewport.width);expect(rect.height).toBe(viewport.height);}
  else {expect(rect.y).toBe(0);expect(rect.width).toBe(viewport.width);expect(rect.height).toBeLessThan(viewport.height*.6);}
  await page.getByRole('button',{name:'メニューを閉じる'}).click();await expect(page.locator('#mode-menu')).toBeHidden();
  await expect(page.getByRole('button',{name:'鳥瞰',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#custom-play')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#custom-timeline')).toBeVisible();
  await expect(page.locator('#journey-clock')).not.toHaveText(time);await expect(page).toHaveURL(/from=19&to=10/);
  await expect(page.locator('#line-map .line-overview-river')).toBeHidden();
  await expect(page.locator('#line-map .station-romaji:visible')).toHaveCount(0);
});

for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) test(`terrain overview moves more slowly than the menu and restores centered tracking at ${viewport.width}px`,async({page})=>{
  let mapboxModule;page.on('request',request=>{if(request.url().includes('/deps/mapbox-gl.js'))mapboxModule=request.url();});
  await page.setViewportSize(viewport);await page.clock.setFixedTime(fixed);await load(page,custom);
  await expect(page.locator('.current-marker')).toBeVisible();await page.waitForTimeout(1200);
  const followedFont=await page.locator('#map [data-station="19"] .station-marker-name').evaluate(node=>getComputedStyle(node).fontSize);
  await page.evaluate(async resource=>{
    const lib=(await import(resource)).default;
    const fit=lib.Map.prototype.fitBounds;
    lib.Map.prototype.fitBounds=function(bounds,options){window.menuMap=this;window.flight={duration:options.duration,padding:options.padding};return fit.call(this,bounds,options);};
    const setFree=lib.Map.prototype.setFreeCameraOptions;
    lib.Map.prototype.setFreeCameraOptions=function(options){
      const before=this.getFreeCameraOptions().position, requested=options.position.toAltitude();
      const result=setFree.call(this,options), after=this.getFreeCameraOptions().position;
      window.returnFrames?.push({jump:Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z)/before.z,correction:Math.abs(after.toAltitude()-requested)});
      return result;
    };
  },mapboxModule);
  await page.getByRole('button',{name:'メニューを開く'}).click();await expect(page.locator('#mode-menu')).toBeVisible();await page.waitForTimeout(100);
  expect(await page.evaluate(()=>window.menuMap.isMoving())).toBe(true);
  expect(await page.evaluate(()=>window.flight.duration)).toBe(1800);
  expect(await page.locator('#mode-menu').evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0.42s');
  await expect.poll(()=>page.evaluate(()=>window.menuMap.isMoving())).toBe(false);
  const scene=await page.evaluate(()=>({zoom:window.menuMap.getZoom(),river:window.menuMap.getLayoutProperty('river','visibility'),tunnels:window.menuMap.getLayoutProperty('tunnels','visibility'),route:window.menuMap.getLayoutProperty('overview-route','visibility')}));
  expect(scene.zoom).toBeLessThan(14);expect(scene.river).toBe('none');expect(scene.tunnels).toBe('none');expect(scene.route).toBe('visible');
  const mobile=viewport.width<=760;
  for (const layer of ['overview-route','overview-river']) {
    expect(await page.evaluate(id=>window.menuMap.getPaintProperty(id,'line-width'),layer)).toBe(mobile?2.5:6);
  }
  const tickErrors=await page.evaluate(async()=>{
    const {createRailProfile}=await import('/src/rail-elevation.js');
    const rail=await (await fetch('/data/railway-route.json')).json(),profile=createRailProfile(rail);
    return [...document.querySelectorAll('#map .station-marker:not([hidden])')].map(element=>{
      const station=rail.stations.find(station=>station.order===Number(element.dataset.station));
      const point=window.menuMap.project(profile.coordinateAt(station.s)),tick=element.querySelector('.station-tick').getBoundingClientRect();
      return Math.hypot(tick.x+tick.width/2-point.x,tick.y+tick.height/2-point.y);
    });
  });
  expect(Math.max(...tickErrors)).toBeLessThan(1);
  const widths=await page.locator('#map .station-marker:not([hidden]) .station-tick').evaluateAll(nodes=>nodes.map(node=>({endpoint:node.parentNode.classList.contains('section-endpoint'),width:node.offsetWidth,height:node.offsetHeight})));
  expect(widths.every(tick=>tick.width===(mobile?14:tick.endpoint?44:28)&&tick.height===(mobile?3:tick.endpoint?10:6))).toBe(true);
  await expect(page.locator('.station-marker:not([hidden])')).toHaveCount(11);await expect(page.locator('.overview-train')).toHaveCount(1);
  await expect(page.locator('.overview-train')).toHaveCSS('width',mobile?'12px':'22px');
  await checkOverviewNames(page,'#map .station-marker:not([hidden]) .station-marker-name',viewport.width<=760);
  expect(await page.evaluate(()=>window.menuMap.getLayoutProperty('overview-river','visibility'))).toBe('visible');
  expect(await page.evaluate(()=>window.menuMap.getPaintProperty('overview-river','line-opacity'))).toBe(.55);
  await expect(page.locator('.overview-train')).toHaveText('樽見発 10:33–11:04');
  await page.evaluate(()=>{window.returnFrames=[];});
  await page.getByRole('button',{name:'メニューを閉じる'}).click();await expect(page.locator('#mode-menu')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/menu-returning/);
  await expect.poll(()=>page.evaluate(()=>{
    const p=document.querySelector('.map-panel').getBoundingClientRect(),m=document.querySelector('.current-marker').getBoundingClientRect();
    return Math.hypot(m.x+m.width/2-p.x-p.width/2,m.y+m.height/2-p.y-p.height/2);
  })).toBeLessThan(6);
  const frames=await page.evaluate(()=>window.returnFrames);
  expect(frames.length).toBeGreaterThan(20);expect(frames[0].jump).toBeLessThan(.02);
  expect(Math.max(...frames.map(frame=>frame.correction))).toBeLessThan(1);
  expect(await page.evaluate(()=>window.menuMap.getLayoutProperty('tunnels','visibility'))).toBe('visible');
  expect(await page.evaluate(()=>window.menuMap.getLayoutProperty('overview-river','visibility'))).toBe('none');
  expect(await page.evaluate(()=>window.menuMap.getLayoutProperty('river','visibility'))).toBe('visible');
  expect(await page.locator('#map [data-station="19"] .station-marker-name').evaluate(node=>getComputedStyle(node).fontSize)).toBe(followedFont);
  await expect(page.locator('#map .station-romaji:visible')).toHaveCount(0);
  await expect(page.locator('.overview-train')).toHaveCount(0);
});

test('reduced-motion menus close without leaving hidden controls or restarting a paused train',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.route('https://*.mapbox.com/**',r=>r.abort());await load(page,custom);
  await page.getByRole('button',{name:'メニューを開く'}).click();
  expect(await page.locator('#mode-menu').evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0s');
  await page.keyboard.press('Escape');await expect(page.locator('#mode-menu')).toBeHidden();
  await expect(page.locator('#custom-play')).toHaveAttribute('aria-pressed','false');await expect(page.locator('#journey-clock')).toHaveText('10:33:00');
  await expect(page.locator('body')).not.toHaveClass(/menu-returning/);
});
