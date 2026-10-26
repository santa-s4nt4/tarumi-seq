import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tarumi-api-endpoint', 'http://localhost:8787/api/position'));
});

async function seekGPS(page, time) {
  await page.locator('#seek').evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, time);
}

async function startTimetable(page) {
  await page.goto('/que');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.locator('#simulation-button').click();
  await page.locator('#simulation-departure').selectOption('5');
  await page.locator('#simulation-start').click();
  await page.locator('#play[aria-pressed="true"]').click();
}

test('station countdown starts at ten, moves within a second, follows pause/rate/seek and clears at arrival', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await startTimetable(page);
  const arrival = 7 * 3600 + 51 * 60 + 30;
  const focus = page.locator('#cue-countdown-focus');
  const progress = page.locator('.countdown-progress');
  await page.locator('#speed').selectOption('4');
  await seekGPS(page, arrival - 10.1);
  await expect(focus).toBeHidden();
  await seekGPS(page, arrival - 10);
  await expect(focus).toBeVisible();
  await expect(page.locator('#countdown-target')).toHaveText('木知原駅まで');
  await expect(page.locator('#countdown-seconds')).toHaveText('10');
  await expect(page.locator('.header')).toBeHidden();
  await expect(page.locator('.cue-overlay')).toBeHidden();
  await expect(page.locator('.map-speed-card')).toBeHidden();
  await expect(page.locator('.que-view-modes')).toBeHidden();
  await expect(page.locator('#play')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#speed')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#front-button')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#back-button')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#timeline-events')).toBeVisible();
  await expect(page.locator('#time-current')).toBeVisible();
  await expect(page.locator('#seek')).toBeInViewport({ ratio: 1 });
  const map = await page.locator('.map-panel').boundingBox();
  const clock = await page.locator('.countdown-clock').boundingBox();
  expect(map.y).toBe(0);
  expect(clock.height).toBeGreaterThan(map.height * 0.75);
  await expect.poll(async () => (await page.locator('.mapboxgl-canvas').boundingBox()).height).toBe(map.height);
  await page.locator('#map').click({ position: { x: 10, y: 10 } });
  const initial = await progress.getAttribute('style');
  await page.keyboard.press('Space');
  await expect.poll(() => progress.getAttribute('style')).not.toBe(initial);
  await page.keyboard.press('Space');
  const paused = await progress.getAttribute('style');
  await page.waitForTimeout(250);
  await expect(progress).toHaveAttribute('style', paused);
  await seekGPS(page, arrival - 8);
  await expect(page.locator('#countdown-seconds')).toHaveText('8');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/countdown-station-desktop.png' });
  await page.locator('#play').click();
  await expect.poll(async () => Number(await page.locator('#countdown-seconds').textContent()), { intervals: [50], timeout: 1500 }).toBeLessThanOrEqual(4);
  await page.locator('#play').click();
  await seekGPS(page, arrival - 0.2);
  await expect(page.locator('#countdown-seconds')).toHaveText('1');
  await page.locator('#play').click();
  await expect(focus).toBeHidden({ timeout: 1500 });
  await page.locator('#play').click();
  await expect(page.locator('#countdown-seconds')).toHaveText('0');
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText('0');
  await expect(page.locator('.header')).toBeVisible();
  await expect(page.locator('#play')).toBeVisible();
  await page.waitForTimeout(250);
  await expect(focus).toBeHidden();
  await seekGPS(page, arrival - 20);
  await expect(focus).toBeHidden();
  expect(errors).toEqual([]);
});

test('tunnel entrance and passage use the correct label and stale countdown clears on API failure', async ({ page }) => {
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  const { entry, exit } = await page.evaluate(async () => {
    const data = await (await fetch('/data/map-data.json')).json();
    const entry = data.front.events.find(event => event.type === 'tunnel' && event.target === 'entrance');
    const exit = data.front.events.find(event => event.featureId === entry.featureId && event.target === 'exit');
    return { entry, exit };
  });
  const focus = page.locator('#cue-countdown-focus');
  await seekGPS(page, entry.t - 5);
  await expect(focus).toBeVisible();
  await expect(page.locator('#countdown-target')).toHaveText(`${entry.name}まで`);
  await expect(focus).toHaveAttribute('data-target', 'entrance');
  await seekGPS(page, exit.t - 5);
  await expect(focus).toBeVisible();
  await expect(page.locator('#countdown-target')).toHaveText(`${entry.name}通過まで`);
  await expect(focus).toHaveAttribute('data-target', 'exit');
  await page.screenshot({ path: 'test-results/countdown-tunnel-desktop.png' });
  await page.route('**/api/position', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await seekGPS(page, entry.t - 4);
  await expect(page.locator('#cue-status')).toHaveText('API 接続エラー');
  await expect(focus).toBeHidden();
  await page.unroute('**/api/position');
  await page.locator('#cue-retry').click();
  await expect(focus).toBeVisible();
  await seekGPS(page, entry.t - 30);
  await expect(focus).toBeHidden();
  await page.locator('#back-button').click();
  await expect(focus).toBeHidden();
});

test('mobile countdown fills the map and keeps the entire playback footer usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startTimetable(page);
  const arrival = 7 * 3600 + 51 * 60 + 30;
  await seekGPS(page, arrival - 5);
  const focus = page.locator('#cue-countdown-focus');
  await expect(focus).toBeVisible();
  await expect(focus).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.cue-overlay')).toBeHidden();
  await expect(page.locator('#play')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#speed')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#front-button')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#back-button')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.header')).toBeHidden();
  await expect(page.locator('.map-speed-card')).toBeHidden();
  await expect(page.locator('#seek')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect.poll(async () => (await page.locator('.mapboxgl-canvas').boundingBox()).height).toBe((await page.locator('.map-panel').boundingBox()).height);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/countdown-station-mobile.png' });
  await seekGPS(page, arrival);
  await expect(focus).toBeHidden();
  await expect(page.locator('.cue-overlay')).toBeVisible();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('.header')).toBeVisible();
});

test('GPS playback naturally finishes its fractional last second without waiting for another API poll', async ({ page }) => {
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  const arrival = await page.evaluate(async () => (await (await fetch('/data/map-data.json')).json()).front.events.find(event => event.type === 'station').t);
  await seekGPS(page, arrival - 0.3);
  const focus = page.locator('#cue-countdown-focus');
  await expect(focus).toBeVisible();
  await expect(page.locator('#countdown-seconds')).toHaveText('1');
  await page.locator('#play').click();
  await expect(focus).toBeHidden({ timeout: 1500 });
  await page.locator('#play').click();
  await expect(page.locator('#countdown-seconds')).toHaveText('0');
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText('0');
  await page.waitForTimeout(300);
  await expect(focus).toBeHidden();
});
