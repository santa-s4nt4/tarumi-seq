import { test, expect } from '@playwright/test';
const fixed = new Date('2026-11-20T15:30:00+09:00');
test.beforeEach(async ({page}) => {
  await page.route('https://*.mapbox.com/**', route=>route.abort());
  await page.clock.setFixedTime(fixed);
});
async function open(page,path='/') { await page.goto(path); await expect(page.locator('#loading')).toBeHidden(); }
async function seekPercent(page,value) { await page.locator('#custom-seek').evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},value); }
test('top modal chooses LIVE and each screen returns to the same menu',async({page})=>{
  const requests=[];page.on('request',r=>{if(/\/api\/|\/local-api|tarumi-api\./.test(r.url()))requests.push(r.url())});
  await open(page);await expect(page.locator('#mode-menu')).toBeVisible();
  await expect(page.getByRole('button',{name:'メニューを閉じる'})).toBeHidden();
  await page.keyboard.press('Escape');await expect(page.locator('#mode-menu')).toBeVisible();
  await expect(page.locator('#menu-clock')).toHaveText('15:30:00');
  await page.locator('#menu-trains [role=option]').first().click();
  await expect(page).toHaveURL(/\/$/);
  await page.locator('#mode-live').getByRole('button',{name:'OK',exact:true}).click();
  await expect(page).toHaveURL(/\/live\/\?train=/);await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.journey-views button:visible')).toHaveText(['自動','進行方向','鳥瞰']);
  await expect(page.locator('#journey-clock')).toHaveText('15:30:00');
  await expect(page.locator('footer')).toHaveCount(0);
  await page.getByRole('button',{name:'メニューを開く'}).click();
  await expect(page.locator('#mode-menu')).toBeVisible();
  await expect(page.getByRole('button',{name:'メニューを閉じる'})).toBeVisible();
  await page.getByRole('tab',{name:'CUSTOM'}).click();
  await page.locator('#custom-service [data-train="23"]').click();
  await page.getByRole('button',{name:'OK',exact:true}).click();
  await expect(page).toHaveURL(/\/custom\/\?train=23&day=weekday/);
  await expect(page.locator('.journey-views button')).toHaveText(['自動','進行方向','鳥瞰','車窓']);
  expect(requests).toEqual([]);
});
test('off-hours LIVE confirmation is disabled while holiday CUSTOM remains available',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-11-22T03:00:00+09:00')); await open(page);
  await expect(page.locator('#menu-trains [role=option]')).toHaveCount(0);await expect(page.locator('#mode-live .mode-confirm')).toBeDisabled();
  await page.getByRole('tab',{name:'CUSTOM'}).click();await expect(page.locator('input[value="holiday"]')).toBeChecked();
  await page.locator('input[value="back"]').check();await expect(page.locator('#custom-service [role=option]').first()).toContainText('発');
});
test('CUSTOM station handles clamp the range, survive reload, and stop on OUT',async({page})=>{
  await open(page,'/custom/?train=23&day=weekday');
  await expect(page.locator('.custom-station')).toHaveCount(11);
  await expect(page.locator('#journey-clock')).toHaveText('15:43:00');
  await page.getByRole('slider',{name:'再生開始駅 IN'}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#section-name')).toHaveText('織部 → 樽見');
  await page.getByRole('slider',{name:'再生終了駅 OUT'}).focus();await page.keyboard.press('Home');
  await expect(page.locator('#section-name')).toHaveText('織部 → 木知原');
  await expect(page).toHaveURL(/from=10&to=11/);
  await page.reload();await expect(page.locator('#section-name')).toHaveText('織部 → 木知原');
  await seekPercent(page,1000);await expect(page.locator('#journey-clock')).toHaveText('15:49:30');
  await expect(page.locator('#custom-play')).toHaveAttribute('aria-label','再生');
  await page.locator('#custom-play').click();await expect(page.locator('#journey-clock')).toHaveText(/15:45:0\d/);
  await page.getByRole('button',{name:'メニューを開く'}).click();const paused=await page.locator('#journey-clock').textContent();
  await page.waitForTimeout(1100);expect(await page.locator('#journey-clock').textContent()).toBe(paused);
});
test('CUSTOM does not enter countdown mode before or on a station arrival',async({page})=>{
  await open(page,'/custom/?train=23&day=weekday');
  // First leg 15:43:00 -> 15:44:30; one station interval is 1/10 of the seek range.
  await seekPercent(page,(81/90)/10*1000);
  await expect(page.locator('.cue-primary h2')).toHaveText('織部駅まで');
  await expect(page.locator('.cue-primary strong')).toHaveText('9');
  await expect(page.locator('#cue-countdown-focus')).toBeHidden();
  await page.locator('#custom-play').click();await expect(page.locator('.cue-primary strong')).toHaveText('8');
  await expect(page.locator('#cue-countdown-focus')).toBeHidden();
  await page.locator('#custom-play').click();await page.getByRole('button',{name:'織部駅へ移動',exact:true}).click();
  await expect(page.locator('.cue-primary strong')).toHaveText('0');
  await expect(page.locator('#cue-countdown-focus')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/countdown-mode/);
});
for (const [train, from, to, start, end, names] of [
  ['23',9,19,'15:43:00','16:16:00',['本巣','織部','木知原','谷汲口','神海','高科','鍋原','日当','高尾','水鳥','樽見']],
  ['18',19,9,'10:33:00','11:04:00',['樽見','水鳥','高尾','日当','鍋原','高科','神海','谷汲口','木知原','織部','本巣']],
]) test(`old full-line CUSTOM links are confined to Motosu–Tarumi: train ${train}`,async({page})=>{
  await open(page,`/custom/?train=${train}&day=holiday&from=${from===9?1:from}&to=${to===9?1:to}`);
  await expect(page).toHaveURL(new RegExp(`from=${from}&to=${to}$`));
  await expect(page.locator('.custom-station')).toHaveText(names);
  await expect(page.locator('#journey-clock')).toHaveText(start);
  await page.locator('.range-in').focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.range-in')).toHaveAttribute('aria-valuetext',names[0]);
  await page.locator('.range-out').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.range-out')).toHaveAttribute('aria-valuetext',names.at(-1));
  await seekPercent(page,1000); await expect(page.locator('#journey-clock')).toHaveText(end);
  await expect(page.locator('#custom-next')).toBeDisabled(); await expect(page.locator('#custom-forward')).toBeDisabled();
  await seekPercent(page,0); await expect(page.locator('#journey-clock')).toHaveText(start);
  await expect(page.locator('#custom-prev')).toBeDisabled(); await expect(page.locator('#custom-back')).toBeDisabled();
  await page.reload(); await expect(page.locator('#journey-clock')).toHaveText(start);
});
test('legacy QUE links preserve station ranges and video is only a CUSTOM view',async({page})=>{
  await page.route('https://www.youtube.com/**',r=>r.abort());
  await open(page,'/que/?mode=playback&train=23&day=weekday&from=9&to=18');
  await expect(page).toHaveURL(/\/custom\/\?train=23&day=weekday&from=9&to=18/);
  await expect(page.locator('#section-name')).toHaveText('本巣 → 水鳥');
  await page.getByRole('button',{name:'車窓',exact:true}).click();await expect(page.locator('#journey-video')).toHaveAttribute('src',/m-jjJKsWI24/);
  await page.getByRole('button',{name:'鳥瞰',exact:true}).click();await expect(page.locator('#journey-video')).toHaveCount(0);
});
for(const viewport of [{width:390,height:844},{width:768,height:1024}]) test(`CUSTOM fits ${viewport.width}px and range markers work with dragging`,async({page})=>{
  await page.setViewportSize(viewport);await open(page,'/custom/?train=23&day=weekday');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(viewport.width);
  const footer=await page.locator('#custom-timeline').boundingBox();expect(footer.y+footer.height).toBeLessThanOrEqual(viewport.height);
  const track=await page.locator('.station-timeline').boundingBox();
  const stationCount=await page.locator('.custom-station').count();
  const marker=page.locator('.range-in'), box=await marker.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+track.width/(stationCount-1)*2,box.y+box.height/2);await page.mouse.up();
  await expect(marker).toHaveAttribute('aria-valuenow','2');
  await page.screenshot({path:`test-results/custom-${viewport.width}.png`});
});
test('station dwell freezes later cues while the CUSTOM clock continues',async({page})=>{
  await open(page,'/custom/?train=23&day=weekday');
  await page.getByRole('button',{name:'織部駅へ移動',exact:true}).click();
  await expect(page.locator('#journey-clock')).toHaveText('15:44:30');
  await expect(page.locator('.cue-primary strong')).toHaveText('0');
  const second=await page.locator('.cue-card strong').nth(1).textContent();
  await page.locator('#custom-play').click();await expect(page.locator('#journey-clock')).toHaveText('15:44:31');
  await expect(page.locator('.cue-card strong').nth(1)).toHaveText(second);await expect(page.locator('#journey-speed')).toHaveText('0.0');
});
test('reverse CUSTOM retains its terminal and exposes only the selected station range',async({page})=>{
  await open(page,'/custom/?train=24&day=weekday&from=19&to=9');
  await expect(page.locator('#section-name')).toHaveText('樽見 → 本巣');
  await seekPercent(page,1000);await expect(page.locator('.cue-primary h2')).toHaveText('本巣駅まで');
  await expect(page.locator('.cue-primary strong')).toHaveText('0');await expect(page.locator('#custom-play')).toHaveAttribute('aria-label','再生');
});
test('tunnel countdown runs at entry and exit, pauses and clears on seeking outside',async({page})=>{
  await open(page,'/custom/?train=23&day=weekday');
  const times=await page.evaluate(async()=>{
    const {customPlan}=await import('/src/journey.js');
    const [tt,rail,stations]=await Promise.all(['timetable-reference','railway-route','stations'].map(async n=>(await fetch('/data/'+n+'.json')).json()));
    const plan=customPlan(tt,rail,stations.stations,{trainId:'23',day:'weekday'}), tunnel=plan.tunnels[0];
    const stopTimes=plan.stops.map((s,i)=>i===0?s.departureSeconds:s.arrivalSeconds);
    function percent(t){for(let i=1;i<stopTimes.length;i++)if(t<=stopTimes[i])return (i-1+(t-stopTimes[i-1])/(stopTimes[i]-stopTimes[i-1]))/(stopTimes.length-1)*1000;}
    return {before:percent(tunnel.entryT-8.5),inside:percent(tunnel.exitT-8.5),clear:percent(tunnel.entryT-30)};
  });
  for (const [position,target] of [[times.before,'開始まで'],[times.inside,'終了まで']]) {
    await seekPercent(page,position);await expect(page.locator('#countdown-target')).toContainText(target);
    await expect(page.locator('#cue-countdown-focus')).toBeVisible();
    await expect(page.locator('#countdown-seconds')).toHaveText('9');
    await page.waitForTimeout(300);await expect(page.locator('#countdown-seconds')).toHaveText('9');
    await page.locator('#custom-play').click();await expect(page.locator('#countdown-seconds')).toHaveText('8');
    await page.locator('#custom-play').click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('#cue-list')).toContainText('終了まで');
  await seekPercent(page,times.clear);await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.locator('#cue-countdown-focus')).toBeHidden();
});

for (const trainId of ['18','23']) test(`LIVE only shows a focus countdown at tunnel entry and exit: train ${trainId}`,async({page})=>{
  await open(page,`/live/?train=${trainId}`);
  const times=await page.evaluate(async trainId=>{
    const {customPlan}=await import('/src/journey.js');
    const [tt,rail,stations]=await Promise.all(['timetable-reference','railway-route','stations'].map(async n=>(await fetch('/data/'+n+'.json')).json()));
    const plan=customPlan(tt,rail,stations.stations,{trainId,day:'weekday'}), tunnel=plan.tunnels.at(-1);
    return {station:plan.stops[1].arrivalSeconds,entry:tunnel.entryT,exit:tunnel.exitT};
  },trainId);
  const epoch=Date.parse('2026-11-20T00:00:00+09:00');
  for (const seconds of [times.station-9,times.station]) {
    await page.clock.setFixedTime(new Date(epoch+seconds*1000));
    await expect(page.locator('.cue-primary .cue-category')).toHaveText('駅');
    await expect(page.locator('.cue-primary strong')).toHaveText(seconds===times.station?'0':'9');
    await expect(page.locator('#cue-countdown-focus')).toBeHidden();
  }
  for (const [seconds,target] of [[times.entry-8.5,'開始まで'],[times.exit-8.5,'終了まで']]) {
    await page.clock.setFixedTime(new Date(epoch+seconds*1000));
    await expect(page.locator('#cue-countdown-focus')).toBeVisible();
    await expect(page.locator('#countdown-target')).toContainText(target);
    await expect(page.locator('#countdown-seconds')).toHaveText('9');
  }
});
