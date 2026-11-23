import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { activeServices } from '../../src/journey.js';
// The menu label hides while idle; any pointer movement brings it back down.
const openMenu = async page => { await page.mouse.move(40, 200); await page.mouse.move(48, 208); await page.getByRole('button', { name: 'メニューを開く' }).click(); };
const timetable=JSON.parse(fs.readFileSync('public/data/timetable-reference.json'));
test('QR scan switches to the map without starting GPS; iPad follows PC selection and camera',async({page,browser,baseURL,request})=>{
  await page.route('https://*.mapbox.com/**',r=>r.abort());
  await page.goto('/performance/');await expect(page.locator('#performance-qr')).toBeVisible();
  await expect(page.locator('#performance-qr img')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#performance-qr')).toBeVisible();
  await expect(page.locator('#performance-qr .mode-close')).toHaveCount(0);
  const senderURL=new URL(await page.locator('.sender-link').getAttribute('href'));
  const sharedURL=new URL(await page.locator('#performance-qr input').inputValue());
  const keys=new URLSearchParams(senderURL.hash.slice(1));
  const reader=new URLSearchParams(sharedURL.hash.slice(1)).get('key');
  const context=await browser.newContext();
  await context.addInitScript(()=>{
    window.gpsStarts=0;
    Object.defineProperty(navigator,'geolocation',{value:{watchPosition(){window.gpsStarts++;return 1;},clearWatch(){}}});
  });
  const phone=await context.newPage();await phone.goto(baseURL+'/performance/'+senderURL.hash);
  await expect(page.locator('#performance-qr')).toBeHidden();
  expect(await phone.evaluate(()=>window.gpsStarts)).toBe(0);
  await phone.getByRole('button',{name:'GPSを送信する',exact:true}).click();
  expect(await phone.evaluate(()=>window.gpsStarts)).toBe(1);
  const train=activeServices(timetable,Date.now())[0]??timetable.trains[0];
  await page.locator('#performance-train').selectOption(train.id);
  const ipad=await browser.newPage({viewport:{width:768,height:1024}});await ipad.route('https://*.mapbox.com/**',r=>r.abort());
  await ipad.goto(baseURL+'/performance/'+sharedURL.hash);
  await expect(ipad.locator('#performance-qr')).toBeHidden();await expect(ipad.locator('#performance-train')).toHaveValue(train.id);
  await expect(ipad.locator('#performance-train')).toBeDisabled();
  if(activeServices(timetable,Date.now()).length) {
    await page.getByRole('button',{name:'鳥瞰',exact:true}).click();
    await expect(ipad.locator('[data-view="bird"]')).toHaveAttribute('aria-pressed','true');
  }
  await openMenu(page);await expect(page.locator('#performance-qr')).toBeVisible();
  await phone.reload();await expect(page.locator('#performance-qr')).toBeHidden();
  await request.delete('/local-api/api/gps-links/'+keys.get('gps-send'),{headers:{Authorization:'Bearer '+reader}});
  await expect(page.locator('#performance-qr')).toBeVisible();await expect(page.locator('.performance-retry')).toBeVisible();
  await ipad.close();await context.close();
});
test('confirmed smartphone fixes correct delay and share it without restarting past cues',async({page})=>{
  const {LiveTimetable}=await import('../../src/live-timetable.js');
  const {createRailProfile}=await import('../../src/rail-elevation.js');
  const {positionAlong}=await import('../../src/simulation.js');
  const rail=JSON.parse(fs.readFileSync('public/data/railway-route.json')), stations=JSON.parse(fs.readFileSync('public/data/stations.json')).stations;
  const now=Date.parse('2026-11-20T15:30:00+09:00'), fleet=new LiveTimetable(timetable,rail,stations);
  fleet.at(now);const run=fleet.runs.find(r=>r.train.id==='23'), profile=createRailProfile(rail);
  const id='00000000-0000-0000-0000-000000000001',reader='a'.repeat(64),writer='b'.repeat(64);
  let position=null, view=null;
  await page.clock.setFixedTime(new Date(now));await page.route('https://*.mapbox.com/**',r=>r.abort());
  await page.route('**/local-api/api/gps-links**',async route=>{
    const method=route.request().method();
    if(method==='POST') await route.fulfill({status:201,json:{id,reader,writer,expiresAt:now+7200000}});
    else if(method==='PATCH'){view=route.request().postDataJSON();await route.fulfill({json:{saved:true}});}
    else await route.fulfill({json:{position,view,joinedAt:now+1,expiresAt:now+7200000}});
  });
  await page.goto('/performance/');await expect(page.locator('#performance-qr')).toBeHidden();await page.locator('#performance-train').selectOption('23');
  await expect.poll(()=>view?.delay).toBe(0);
  for(const elapsed of [1000,4000]) {
    const timestamp=now+elapsed, point=positionAlong(run,run.secondsAt(timestamp)-120), [longitude,latitude]=profile.coordinateAt(point.s);
    position={timestamp,coords:{longitude,latitude,accuracy:5,speed:point.speed/3.6}};
    await page.clock.setFixedTime(new Date(timestamp));
    await expect(page.locator('#performance-status')).toContainText('GPS受信中');
    if(elapsed===1000) await page.waitForTimeout(1000);
  }
  await expect.poll(()=>view?.delay).toBe(120);
  await expect(page.locator('#cue-list')).toContainText('120秒遅れ');
});
