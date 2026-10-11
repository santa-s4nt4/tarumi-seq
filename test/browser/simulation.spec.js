import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tarumi-api-endpoint', 'http://localhost:8787/api/position'));
});
const seconds = time => { const [h,m,s=0] = time.split(':').map(Number); return h*3600+m*60+s; };
async function seek(page,time) { await page.locator('#seek').evaluate((element,value)=>{element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));},seconds(time)); }
async function pause(page) { if (await page.locator('#play').getAttribute('aria-pressed') === 'true') await page.locator('#play').click(); }
async function setup(page) {
  await page.goto('/que'); await expect(page.locator('.current-marker')).toBeVisible();
  await page.locator('#simulation-button').click(); await expect(page.locator('#simulation-dialog')).toBeVisible();
}

test('selects a Motosu–Tarumi train, holds station dwell without API polling and restores GPS playback', async ({ page }) => {
  const errors=[], requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().endsWith('/api/position')) requests.push(request.url());});
  await setup(page);
  await expect(page.locator('#simulation-station option')).toHaveCount(11);
  await expect(page.locator('#simulation-station')).toHaveValue('9');
  await expect(page.locator('#simulation-station option[value="1"]')).toHaveCount(0);
  await page.locator('#simulation-departure').selectOption('5');
  await expect(page.locator('#simulation-route')).toHaveText('本巣 → 樽見');
  const motosu = page.locator('#simulation-stops tr').filter({hasText:'本巣'});
  await expect(motosu).not.toContainText('07:35'); await expect(motosu).toContainText('07:45');
  await page.screenshot({path:'test-results/simulation-select-desktop.png'});
  await page.locator('#simulation-start').click(); await pause(page);
  await expect(page.locator('body')).toHaveClass(/timetable-mode/);
  await expect(page.locator('#api-badge-text')).toHaveText('ダイヤ再生');
  await expect(page.locator('#seek')).toHaveAttribute('min',String(seconds('07:45')));
  await expect(page.locator('#time-end')).toHaveText('08:19:00');
  await expect(page.locator('.station-marker')).toHaveCount(11);
  const initialRequests=requests.length;
  await seek(page,'07:51:30');
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('木知原駅まで');
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText('0');
  await expect(page.locator('#map-train-speed')).toHaveText('0.0');
  const etas=await page.locator('#cue-list .cue-card:not(.cue-primary) strong').allTextContents();
  const location=await page.locator('#latitude').textContent();
  await page.locator('#speed').selectOption('1'); await page.locator('#play').click();
  await page.waitForTimeout(5500); await pause(page);
  expect(requests.length).toBe(initialRequests);
  expect(await page.locator('#cue-list .cue-card:not(.cue-primary) strong').allTextContents()).toEqual(etas);
  await expect(page.locator('#latitude')).toHaveText(location);
  await expect(page.locator('#map-train-speed')).toHaveText('0.0');
  await seek(page,'07:52');
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('谷汲口駅まで');
  await page.locator('#simulation-button').click(); await page.locator('#simulation-restore').click();
  await expect(page.locator('body')).not.toHaveClass(/timetable-mode/);
  await expect(page.locator('#time-current')).toHaveText('06:59');
  await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み');
  await expect(page.locator('.station-marker')).toHaveCount(11);
  expect(requests.length).toBeGreaterThan(initialRequests);
  expect(errors).toEqual([]);
});

test('keeps both day choices within the section and ends up trains at the published Motosu arrival', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#simulation-departure option[value="1001"]')).toHaveCount(0);
  await page.locator('#simulation-day').selectOption('holiday');
  await expect(page.locator('#simulation-departure option[value="1001"]')).toHaveCount(0);
  await expect(page.locator('#simulation-departure option')).toHaveCount(11);
  await expect(page.locator('#simulation-route')).toHaveText('本巣 → 樽見');
  await page.locator('#simulation-day').selectOption('weekday');
  await expect(page.locator('#simulation-departure option[value="1001"]')).toHaveCount(0);
  await page.locator('#simulation-direction').selectOption('back');
  await expect(page.locator('#simulation-station')).toHaveValue('19');
  await page.locator('#simulation-departure').selectOption('1036');
  await expect(page.locator('#simulation-note')).toBeHidden();
  await expect(page.locator('#simulation-route')).toHaveText('樽見 → 本巣');
  const motosu = page.locator('#simulation-stops tr').filter({hasText:'本巣'});
  await expect(motosu).toContainText('19:44'); await expect(motosu).not.toContainText('20:21');
  await page.locator('#simulation-start').click(); await pause(page);
  await expect(page.locator('#time-end')).toHaveText('19:44:00');
  await seek(page,'19:44');
  await expect(page.locator('#map-train-speed')).toHaveText('0.0');
  await expect(page.locator('#cue-status')).toHaveText('本巣駅に到着 · シミュレーション終了');
  await page.locator('#front-button').click();
  await expect(page.locator('#simulation-station')).toHaveValue('9');
  await expect(page.locator('#simulation-route')).toHaveText('本巣 → 樽見');
});

test('starts from a middle station, keeps tunnel cues on the timetable and opens direction selection', async ({ page }) => {
  await setup(page);
  await page.locator('#simulation-station').selectOption('11');
  await page.locator('#simulation-departure').selectOption('13');
  await expect(page.locator('#simulation-route')).toHaveText('木知原 → 樽見');
  await expect(page.locator('#simulation-stops tr').first()).toContainText('09:48');
  await page.locator('#simulation-start').click(); await pause(page);
  await expect(page.locator('#seek')).toHaveAttribute('min',String(seconds('09:48')));
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('谷汲口駅まで');
  await seek(page,'10:08');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('#map-tunnel-banner')).toHaveText('トンネル7内を走行中');
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('トンネル7通過まで');
  await page.screenshot({path:'test-results/simulation-tunnel.png'});
  await page.locator('#back-button').click();
  await expect(page.locator('#simulation-dialog')).toBeVisible();
  await expect(page.locator('#simulation-direction')).toHaveValue('back');
  await expect(page.locator('#simulation-station')).toHaveValue('11');
});

test('timetable playback remains available when the position API is unavailable', async ({ page }) => {
  await page.route('**/api/position',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
  await setup(page);
  await page.locator('#simulation-departure').selectOption('5');
  await page.locator('#simulation-start').click(); await pause(page);
  await expect(page.locator('#api-badge-text')).toHaveText('ダイヤ再生');
  await expect(page.locator('#api-error')).toBeHidden();
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('織部駅まで');
  await expect(page.locator('#map-train-speed')).not.toHaveText('—');
});

test('mobile timetable selection and simulation controls fit the viewport', async ({ page }) => {
  await page.setViewportSize({width:390,height:844}); await setup(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator('#simulation-start')).toBeInViewport();
  await page.locator('#simulation-station').selectOption('14');
  await page.locator('#simulation-departure').selectOption('1');
  await page.screenshot({path:'test-results/simulation-select-mobile.png'});
  await page.locator('#simulation-start').click(); await pause(page);
  await expect(page.locator('#time-end')).toHaveText('07:03:00');
  await expect(page.locator('#play')).toBeInViewport({ratio:1});
  await expect(page.locator('#seek')).toBeInViewport({ratio:1});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({path:'test-results/simulation-playback-mobile.png'});
});
