import { test, expect } from '@playwright/test';

async function choose(page, train = '17', date = '2026-10-26') {
  await page.locator('#reference-button').click();
  await page.locator('#reference-date').fill(date);
  await page.locator('#reference-train').selectOption(train);
  await page.locator('#reference-connect').click();
}
async function live(page, offset = -900) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(ok) { window.gpsFix = ok; return 1; }, clearWatch() { window.gpsFix = null; },
    } });
  });
  await page.goto('/live/');
  await expect(page.locator('#reference-button')).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-10-26T11:28:00+09:00'));
  await page.locator('#live-start').click();
  await page.evaluate(async offset => {
    const { createRailProfile } = await import('/src/rail-elevation.js');
    const railway = await (await fetch('/data/railway-route.json')).json();
    const profile = createRailProfile(railway), station = railway.stations.find(s => s.order === 13);
    const [longitude, latitude] = profile.coordinateAt(station.s + offset);
    window.liveCoords = { longitude, latitude, accuracy: 5, speed: 10 };
    window.gpsFix({ timestamp: Date.now(), coords: window.liveCoords });
  }, offset);
}

test('live small scheduled arrival and difference use the current Japanese clock without replacing GPS cues', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await live(page);
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('神海駅まで');
  const seconds = await page.locator('#cue-list .cue-primary strong').textContent();
  await choose(page);
  const note = page.locator('#cue-list .cue-primary .cue-schedule');
  await expect(note).toContainText('ダイヤ着 11:29:30 *');
  await expect(note).toContainText('発 11:30');
  await expect(note).toContainText('見込との差 ±0秒');
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText(seconds);
  await expect(page.locator('#reference-summary')).toContainText('17列車');
  await page.clock.setFixedTime(new Date('2026-10-26T11:28:15+09:00'));
  await page.evaluate(() => window.gpsFix({ timestamp: Date.now(), coords: window.liveCoords }));
  await expect(note).toContainText('+15秒（遅い）');
  await page.screenshot({ path: 'test-results/live-timetable-mobile.png' });
  await page.locator('#live-stop').click();
  await expect(page.locator('.cue-schedule')).toHaveCount(0);
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
});

test('reference supports mobile selection, holiday trains, disconnect and an opposite direction without stale annotations', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await live(page);
  await page.locator('#reference-button').click();
  await expect(page.locator('#reference-train option[value="1001"]')).toHaveCount(0);
  await page.locator('#reference-day').selectOption('holiday');
  await expect(page.locator('#reference-train option[value="1001"]')).toHaveCount(1);
  await page.locator('#reference-train').selectOption('17');
  await expect(page.locator('#reference-connect')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: 'test-results/timetable-reference-dialog-mobile.png' });
  await page.locator('#reference-connect').click();
  await expect(page.locator('.cue-schedule').first()).toBeVisible();
  await expect(page.locator('#live-stop')).toBeInViewport({ ratio: 1 });
  await page.locator('#live-back').click();
  await expect(page.locator('#reference-summary')).toContainText('方面が異なります');
  await page.locator('#reference-button').click();
  await expect(page.locator('#reference-train option[value="20"]')).toHaveCount(1);
  await expect(page.locator('#reference-train option[value="17"]')).toHaveCount(0);
  await page.locator('#reference-disconnect').click();
  await expect(page.locator('#reference-summary')).toContainText('未接続');
  await expect(page.locator('.cue-schedule')).toHaveCount(0);
});

test('queue timetable playback connects its own train and uses the playback clock through pause and seeking', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tarumi-api-endpoint', 'http://localhost:8787/api/position'));
  await page.goto('/que/');
  await expect(page.locator('#reference-button')).toBeVisible();
  await page.locator('#simulation-button').click();
  await page.locator('#simulation-departure').selectOption('17');
  await page.locator('#simulation-start').click();
  if (await page.locator('#play').getAttribute('aria-pressed') === 'true') await page.locator('#play').click();
  const seek = time => page.locator('#seek').evaluate((element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, time);
  await seek(11 * 3600 + 27 * 60);
  await expect(page.locator('#reference-summary')).toContainText('17列車 · 2024-04-08');
  const note = page.locator('#cue-list .cue-card[data-type="station"] .cue-schedule').first();
  await expect(note).toContainText('ダイヤ着 11:29:30 *');
  await expect(note).toContainText('見込との差 ±0秒');
  const value = await note.textContent(); await page.waitForTimeout(500);
  await expect(note).toHaveText(value);
  await seek(11 * 3600 + 29 * 60 + 30);
  await expect(note).toContainText('差 —（駅付近・停車中）');
  await page.locator('#simulation-button').click();
  await page.locator('#simulation-restore').click();
  await expect(page.locator('#reference-summary')).toContainText('2026-07-17');
  await page.locator('#reference-button').click(); await page.locator('#reference-disconnect').click();
  await expect(page.locator('.cue-schedule')).toHaveCount(0);
});

test('missing optional timetable data leaves live GPS operation available with an explanatory message', async ({ page }) => {
  await page.route('**/data/timetable-reference.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/live/');
  await expect(page.locator('#live-start')).toBeEnabled();
  await expect(page.locator('.timetable-reference')).toContainText('ダイヤ参照を読み込めません');
});

test('live urgent countdown keeps the small timetable reference visible and the large clock inside the map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await live(page, -75);
  await choose(page);
  await expect(page.locator('#cue-countdown-focus')).toBeVisible();
  await expect(page.locator('.cue-overlay')).toBeHidden();
  await expect(page.locator('.countdown-schedule')).toBeVisible();
  await expect(page.locator('.countdown-schedule')).toContainText('ダイヤ着 11:29:30 *');
  await expect(page.locator('#countdown-target')).toHaveText('神海駅まで');
  const map = await page.locator('.map-panel').boundingBox(), clock = await page.locator('.countdown-clock').boundingBox();
  expect(clock.y + clock.height).toBeLessThanOrEqual(map.y + map.height + 1);
  await expect(page.locator('#live-stop')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'test-results/live-timetable-countdown-mobile.png' });
  await page.locator('#live-stop').click();
  await expect(page.locator('.countdown-schedule')).toHaveCount(0);
  await expect(page.locator('#cue-countdown-focus')).toBeHidden();
});
