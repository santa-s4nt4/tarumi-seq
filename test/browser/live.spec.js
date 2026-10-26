import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  if (info.title.startsWith('native')) return;
  await page.addInitScript(() => {
    const watches = new Map(); let id = 0;
    window.fakeGPS = {
      calls: 0, clears: 0, last: null,
      emit(coords) { for (const watch of [...watches.values()]) watch.ok({ coords, timestamp: Date.now() }); },
      fail(code) { for (const watch of [...watches.values()]) watch.bad({ code }); },
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(ok, bad) { window.fakeGPS.calls++; window.fakeGPS.last = ok; watches.set(++id, { ok, bad }); return id; },
      clearWatch(value) { watches.delete(value); window.fakeGPS.clears++; },
    } });
  });
});

async function setup(page) {
  await page.goto('/live/');
  await expect(page.locator('#live-start')).toBeEnabled();
}
async function locationAt(page, offset = -75, speed = 10) {
  return page.evaluate(async ({ offset, speed }) => {
    const { createRailProfile } = await import('/src/rail-elevation.js');
    const railway = await (await fetch('/data/railway-route.json')).json();
    const profile = createRailProfile(railway);
    const station = railway.stations.find(station => station.order === 9);
    const [longitude, latitude] = profile.coordinateAt(station.s + offset);
    return { longitude, latitude, speed, accuracy: 5 };
  }, { offset, speed });
}
async function emit(page, coords) { await page.evaluate(coords => window.fakeGPS.emit(coords), coords); }

test('live GPS requests permission only on start, issues a real-position cue and stops all updates', async ({ page }) => {
  const errors = [], apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/position')) apiRequests.push(request.url()); });
  await setup(page);
  expect(await page.evaluate(() => window.fakeGPS.calls)).toBe(0);
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
  await expect(page.locator('#live-notice')).toBeVisible();
  const coords = await locationAt(page);
  await page.locator('#live-start').click();
  expect(await page.evaluate(() => window.fakeGPS.calls)).toBe(1);
  await emit(page, coords);
  await expect(page.locator('#countdown-target')).toHaveText('本巣駅まで');
  await expect(page.locator('#cue-countdown-focus')).toBeVisible();
  await expect(page.locator('#map-train-speed')).toHaveText('36.0');
  await expect(page.locator('#live-quality')).toHaveText('精度 ±5m');
  await expect(page.locator('#live-stop')).toBeInViewport({ ratio: 1 });
  await page.locator('#live-stop').click();
  await expect(page.locator('#cue-countdown-focus')).toBeHidden();
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
  await expect(page.locator('#live-start')).toBeEnabled();
  await page.evaluate(coords => window.fakeGPS.last({ coords, timestamp: Date.now() }), coords);
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
  expect(await page.evaluate(() => window.fakeGPS.clears)).toBe(1);
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('poor accuracy, off-route positions and lost fixes clear live cues', async ({ page }) => {
  await setup(page);
  const coords = await locationAt(page, -500);
  await page.locator('#live-start').click();
  await emit(page, { ...coords, accuracy: 90 });
  await expect(page.locator('#live-status')).toContainText('測位精度');
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
  await emit(page, { ...coords, longitude: coords.longitude + 0.02 });
  await expect(page.locator('#live-status')).toContainText('路線外');
  await emit(page, coords);
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(3);
  await page.clock.install();
  await emit(page, coords);
  await page.clock.fastForward(4000);
  await expect(page.locator('#live-status')).toContainText('GPS更新待ち');
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
  await expect(page.locator('#cue-countdown-focus')).toBeHidden();
  await expect(page.locator('#map-train-speed')).toHaveText('—');
});

test('permission refusal and backgrounding stop the watch without replaying a recording', async ({ page }) => {
  await setup(page);
  await page.locator('#live-start').click();
  await page.evaluate(() => window.fakeGPS.fail(1));
  await expect(page.locator('#live-status')).toContainText('許可');
  await expect(page.locator('#live-start')).toBeEnabled();
  await page.locator('#live-start').click();
  await emit(page, await locationAt(page, -500));
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(3);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#live-status')).toContainText('非表示');
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
  await expect(page.locator('#live-stop')).toBeDisabled();
  expect(await page.evaluate(() => window.fakeGPS.clears)).toBe(2);
});

test('device speed may be unknown, position differences estimate it, and reversing direction resets predictions', async ({ page }) => {
  await setup(page);
  await page.clock.install();
  await page.locator('#live-start').click();
  await emit(page, await locationAt(page, -500, null));
  await expect(page.locator('#map-train-speed')).toHaveText('—');
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText('—');
  await page.clock.fastForward(2100);
  await emit(page, await locationAt(page, -479, null));
  await expect.poll(async () => Number(await page.locator('#map-train-speed').textContent()), { intervals: [50] }).toBeGreaterThan(35);
  expect(Number(await page.locator('#map-train-speed').textContent())).toBeLessThan(37);
  await page.locator('#live-back').click();
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
  await emit(page, await locationAt(page, 75));
  await expect(page.locator('#countdown-target')).toHaveText('本巣駅まで');
  await expect(page.locator('#cue-countdown-focus')).toBeVisible();
  await expect(page.locator('#live-back')).toHaveAttribute('aria-pressed', 'true');
});

test('mobile live view keeps start/stop and direction usable at small widths and supports cue hiding', async ({ page }) => {
  await setup(page);
  await page.screenshot({ path: 'test-results/live-idle-mobile.png' });
  await page.locator('#live-start').click();
  const coords = await locationAt(page, -500);
  await emit(page, coords);
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('本巣駅まで');
  await page.getByRole('button', { name: '次の合図を非表示', exact: true }).click();
  await expect(page.locator('#cue-content')).toBeHidden();
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.locator('#live-stop')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#live-back')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole('button', { name: '次の合図を表示', exact: true }).click();
  await emit(page, coords);
  await expect(page.locator('#cue-list .cue-primary')).toBeVisible();
  await page.screenshot({ path: 'test-results/live-tracking-mobile.png' });
});

test('native browser Geolocation API works with a simulated device position and the LIVE link', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await page.goto('/que');
  await page.getByRole('link', { name: 'LIVE', exact: true }).click();
  await expect(page).toHaveURL(/\/live\/$/);
  await expect(page.locator('#live-start')).toBeEnabled();
  const coords = await locationAt(page, -500);
  await context.setGeolocation({ latitude: coords.latitude, longitude: coords.longitude, accuracy: 5 });
  await page.locator('#live-start').click();
  await expect(page.locator('#live-status')).toContainText('GPS受信中');
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('本巣駅まで');
  await page.locator('#live-stop').click();
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
});

test('live terrain, full railway and device marker render without map style errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /expression|line-z-offset|style|Could not parse color/i.test(message.text())) errors.push(message.text()); });
  await setup(page);
  await page.locator('#live-start').click();
  const coords = await locationAt(page, -500);
  await emit(page, coords);
  await expect(page.locator('.current-marker')).toBeVisible({ timeout: 15000 });
  await emit(page, coords);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'test-results/live-map-mobile.png' });
  await expect(page.locator('#live-stop')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#cue-list .cue-primary')).toBeVisible();
  expect(errors).toEqual([]);
});
