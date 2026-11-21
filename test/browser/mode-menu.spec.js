import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { activeServices } from '../../src/journey.js';
const fixed=new Date('2026-11-21T10:34:00+09:00');
const timetable=JSON.parse(fs.readFileSync('public/data/timetable-reference.json'));
const custom='/custom/?train=18&day=holiday&from=19&to=10';
async function load(page,path='/') { await page.goto(path);await expect(page.locator('#loading')).toBeHidden(); }

test('LIVE lists every active train and confirms explicitly; CUSTOM is a scrollable keyboard-selectable list',async({page})=>{
  await page.route('https://*.mapbox.com/**',route=>route.abort());await page.clock.setFixedTime(fixed);
  await page.setViewportSize({width:390,height:844});await load(page);
  const choices=page.locator('#menu-trains [role=option]');
  await expect(choices).toHaveCount(activeServices(timetable,+fixed).length);
  await expect(page.locator('#mode-live .mode-confirm')).toBeDisabled();
  await choices.last().click();await expect(choices.last()).toHaveAttribute('aria-selected','true');await expect(page).toHaveURL(/\/$/);
  await page.getByRole('tab',{name:'CUSTOM'}).click();await expect(page.locator('#mode-live')).toBeHidden();
  await expect(page.locator('#custom-service select')).toHaveCount(0);
  const list=page.locator('#custom-service');expect(await list.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  await list.locator('[role=option]').first().focus();await page.keyboard.press('End');
  await expect(list.locator('[role=option]').last()).toHaveAttribute('aria-selected','true');
  expect(await list.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('tab',{name:'LIVE',exact:true}).click();await expect(choices.last()).toHaveAttribute('aria-selected','true');
  const chosen=await choices.last().getAttribute('data-train');await page.locator('#mode-live .mode-confirm').click();
  await expect(page).toHaveURL(new RegExp('/live/\\?train='+chosen+'$'));
});

for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) test(`menu preserves the selected train, time, view and playback at ${viewport.width}px`,async({page})=>{
  await page.route('https://*.mapbox.com/**',route=>route.abort());await page.clock.setFixedTime(fixed);await page.setViewportSize(viewport);await load(page,custom);
  await page.getByRole('button',{name:'鳥瞰',exact:true}).click();await page.locator('#custom-play').click();
  await expect(page.locator('#journey-clock')).toHaveText('10:33:01');await page.getByRole('button',{name:'メニューを開く'}).click();
  const time=await page.locator('#journey-clock').textContent();await page.waitForTimeout(700);
  await expect(page.locator('#journey-clock')).toHaveText(time);await expect(page.locator('#journey-clock')).toBeVisible();
  await expect(page.locator('#journey-speed')).toBeHidden();await expect(page.locator('#custom-timeline')).toBeHidden();await expect(page.locator('.cue-overlay')).toBeHidden();
  await expect(page.locator('#line-map .line-train:not([hidden])')).toHaveCount(1);
  await expect(page.locator('#line-map .line-train:not([hidden])')).toHaveAttribute('data-train','18');
  await expect(page.locator('#line-map .line-train:not([hidden])')).toHaveText('大垣行き');
  await expect(page.locator('#line-map .line-river')).toBeHidden();await expect(page.locator('#line-map .line-track')).toBeHidden();
  const visible=await page.locator('#line-map [data-station]').evaluateAll(nodes=>nodes.filter(e=>getComputedStyle(e).display!=='none').map(e=>Number(e.dataset.station)));
  expect(visible).toEqual([9,10,11,12,13,14,15,16,17,18,19]);
  const rect=await page.locator('#mode-menu').boundingBox();
  if(viewport.width>760) {expect(rect.x+rect.width).toBe(viewport.width);expect(rect.height).toBe(viewport.height);}
  else {expect(rect.y).toBe(0);expect(rect.width).toBe(viewport.width);expect(rect.height).toBeLessThan(viewport.height*.6);}
  await page.getByRole('button',{name:'メニューを閉じる'}).click();await expect(page.locator('#mode-menu')).toBeHidden();
  await expect(page.getByRole('button',{name:'鳥瞰',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#custom-play')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#custom-timeline')).toBeVisible();
  await expect(page.locator('#journey-clock')).not.toHaveText(time);await expect(page).toHaveURL(/from=19&to=10/);
});

for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) test(`terrain overview and menu animate together and restore centered tracking at ${viewport.width}px`,async({page})=>{
  let mapboxModule;page.on('request',request=>{if(request.url().includes('/deps/mapbox-gl.js'))mapboxModule=request.url();});
  await page.setViewportSize(viewport);await page.clock.setFixedTime(fixed);await load(page,custom);
  await expect(page.locator('.current-marker')).toBeVisible();await page.waitForTimeout(1200);
  await page.evaluate(async resource=>{
    const lib=(await import(resource)).default;
    const fit=lib.Map.prototype.fitBounds;
    lib.Map.prototype.fitBounds=function(bounds,options){window.menuMap=this;window.flight={duration:options.duration,padding:options.padding};return fit.call(this,bounds,options);};
  },mapboxModule);
  await page.getByRole('button',{name:'メニューを開く'}).click();await page.waitForTimeout(100);
  expect(await page.evaluate(()=>window.menuMap.isMoving())).toBe(true);
  expect(await page.evaluate(()=>window.flight.duration)).toBe(600);
  expect(await page.locator('#mode-menu').evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0.6s');
  await page.waitForTimeout(700);
  const scene=await page.evaluate(()=>({zoom:window.menuMap.getZoom(),river:window.menuMap.getLayoutProperty('river','visibility'),tunnels:window.menuMap.getLayoutProperty('tunnels','visibility'),route:window.menuMap.getLayoutProperty('overview-route','visibility')}));
  expect(scene.zoom).toBeLessThan(14);expect(scene.river).toBe('none');expect(scene.tunnels).toBe('none');expect(scene.route).toBe('visible');
  await expect(page.locator('.station-marker:not([hidden])')).toHaveCount(11);await expect(page.locator('.overview-train')).toHaveCount(1);
  await expect(page.locator('.overview-train')).toHaveText('大垣行き');
  await page.getByRole('button',{name:'メニューを閉じる'}).click();await expect(page.locator('#mode-menu')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>{
    const p=document.querySelector('.map-panel').getBoundingClientRect(),m=document.querySelector('.current-marker').getBoundingClientRect();
    return Math.hypot(m.x+m.width/2-p.x-p.width/2,m.y+m.height/2-p.y-p.height/2);
  })).toBeLessThan(6);
  expect(await page.evaluate(()=>window.menuMap.getLayoutProperty('tunnels','visibility'))).toBe('visible');
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
