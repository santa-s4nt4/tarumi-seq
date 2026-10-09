import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み', { timeout: 15000 });
}
async function seek(page, t) {
  await page.locator('#seek').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, t);
}

test('polls every five real seconds while countdown and GPS continue; pause freezes the prediction', async ({ page }) => {
  const requests = [];
  page.on('request', r => { if (r.url().endsWith('/api/position') && r.method() === 'POST') requests.push({ at: Date.now(), body: r.postDataJSON() }); });
  await ready(page);
  await page.locator('#speed').selectOption('16'); await page.locator('#play').click();
  await expect.poll(async () => Number(await page.locator('#station-eta').innerText())).toBeLessThan(85);
  expect(requests).toHaveLength(1);
  await expect(page.locator('#station-state')).toHaveText('API応答から補間中');
  await page.locator('#play').click(); const paused = await page.locator('#station-eta').innerText();
  await page.waitForTimeout(300); await expect(page.locator('#station-eta')).toHaveText(paused); expect(requests).toHaveLength(1);
  await page.locator('#speed').selectOption('1');
  const next = page.waitForRequest(r => r.url().endsWith('/api/position') && r.method() === 'POST', { timeout: 15000 });
  await page.locator('#play').click(); await next;
  expect(requests).toHaveLength(2); expect(requests[1].at - requests[0].at).toBeGreaterThanOrEqual(4900);
  const latestT = Number(await page.locator('#seek').inputValue());
  const start = Date.parse('2026-07-17T03:52:47Z');
  const sentT = (Date.parse(requests[1].body.recordedAt) - start) / 1000 + 350;
  expect(Math.abs(latestT - sentT)).toBeLessThan(0.5);
});

test('promotes a station and tunnel exit between polls without an additional request', async ({ page }) => {
  let count = 0;
  await page.route('**/api/position', async route => {
    count++;
    const result = await (await route.fetch()).json();
    const station = result.upcoming.find(e => e.type === 'station');
    const laterStation = result.upcoming.find(e => e.type === 'station' && e.id !== station.id);
    const entrance = result.upcoming.find(e => e.type === 'tunnel' && e.target === 'entrance');
    const exit = result.upcoming.find(e => e.featureId === entrance.featureId && e.target === 'exit');
    result.upcoming = [{ ...station, target: 'station_point', etaSeconds: 1 }, { ...entrance, etaSeconds: 2 }, { ...exit, etaSeconds: 20 }, { ...laterStation, etaSeconds: 40 }];
    result.next.station = result.upcoming[0]; result.next.tunnel = result.upcoming[1];
    await route.fulfill({ json: result });
  });
  await ready(page); await page.locator('#speed').selectOption('4'); await page.locator('#play').click();
  await expect(page.locator('#station-name')).toHaveText('谷汲口');
  await expect(page.locator('#tunnel-heading')).toHaveText('トンネル出口まで');
  await expect(page.locator('#tunnel-detail')).toContainText('出口まで'); expect(count).toBe(1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#speed').selectOption('16');
  await expect(page.locator('#tunnel-status')).toHaveText('OUTSIDE');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(count).toBe(1);
});

test('renders real API predictions and Mapbox route; sends the corrected GPS timestamp', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const request = page.waitForRequest(r => r.url().endsWith('/api/position') && r.method() === 'POST');
  await ready(page);
  const body = (await request).postDataJSON();
  expect(body).toEqual({ latitude: 35.514371, longitude: 136.653235, direction: 'front', recordedAt: '2026-07-17T03:53:56.000Z' });
  await expect(page.locator('#station-name')).toHaveText('木知原');
  await expect(page.locator('#station-distance')).toHaveText('492');
  await expect(page.locator('#river-distance')).toHaveText('115');
  await expect(page.locator('.current-marker')).toBeVisible();
  await expect(page.locator('.station-marker')).toHaveCount(11);
  await expect(page.locator('.mapboxgl-canvas')).toBeVisible();
  const columns = await page.locator('.prediction-columns article').evaluateAll(els => els.map(el => ({ name: el.className, x: el.getBoundingClientRect().x })));
  expect(columns.map(c => c.name)).toEqual(['station-block', 'tunnel-block', 'river-block']);
  expect(columns[0].x).toBeLessThan(columns[1].x);
  expect(columns[1].x).toBeLessThan(columns[2].x);
  expect(errors).toEqual([]);
});

test('playback, speed, pause, skip and seeking move the actual GPS request', async ({ page }) => {
  await ready(page);
  await page.locator('#speed').selectOption('4');
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('#seek').inputValue())).toBeGreaterThan(423);
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  const stopped = Number(await page.locator('#seek').inputValue());
  await page.getByRole('button', { name: '10秒進む' }).click();
  expect(Number(await page.locator('#seek').inputValue())).toBeCloseTo(stopped + 10, 0);
  const request = page.waitForRequest(r => r.url().endsWith('/api/position') && r.postDataJSON()?.recordedAt === '2026-07-17T04:00:17.000Z');
  await seek(page, 800);
  expect((await request).postDataJSON().direction).toBe('front');
  await expect(page.locator('#time-current')).toHaveText('13:20');
  await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み');
});

test('direction switching and station skipping use the selected recording', async ({ page }) => {
  await ready(page);
  const response = page.waitForResponse(r => r.url().endsWith('/api/position') && r.request().postDataJSON()?.direction === 'back');
  await page.locator('#back-button').click();
  expect((await response).request().postDataJSON().recordedAt).toBe('2026-07-17T04:33:19.000Z');
  await expect(page.locator('#time-current')).toHaveText('00:03');
  await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み');
  await page.getByRole('button', { name: '次の駅へ', exact: true }).click();
  expect(Number(await page.locator('#seek').inputValue())).toBeGreaterThan(3);
  await page.locator('#front-button').click();
  await expect(page.locator('#time-current')).toHaveText('06:59');
});

test('tunnel interior switches the prediction to its exit; record endpoint stops playback', async ({ page }) => {
  await ready(page);
  const meta = JSON.parse(fs.readFileSync('public/data/map-data.json', 'utf8')).front;
  const entrance = meta.events.find(e => e.type === 'tunnel' && e.target === 'entrance');
  const response = page.waitForResponse(r => r.url().endsWith('/api/position') && r.request().postDataJSON()?.latitude > entrance.location.latitude);
  await seek(page, entrance.t + 5);
  await response;
  await expect(page.locator('#tunnel-heading')).toHaveText('トンネル出口まで');
  await expect(page.locator('#tunnel-detail')).toContainText('出口まで');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const exit = meta.events.find(e => e.featureId === entrance.featureId && e.target === 'exit');
  await seek(page, exit.t + 1);
  await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await seek(page, 2210.5);
  await page.locator('#speed').selectOption('16');
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.getByRole('button', { name: '再生', exact: true })).toBeVisible();
  await expect(page.locator('#seek')).toHaveValue('2211');
});

test('API failures clear predictions and retry reconnects; connection settings show raw diagnostics', async ({ page }) => {
  await page.route('**/api/position', route => route.fulfill({ status: 503, json: { error: 'dataset_unavailable', message: '参照データ未登録' } }));
  await page.goto('/');
  await expect(page.locator('#api-error')).toBeVisible();
  await expect(page.locator('#api-error-message')).toContainText('503');
  await expect(page.locator('#station-name')).toHaveText('—');
  await page.unroute('**/api/position');
  await page.getByRole('button', { name: '再接続', exact: true }).click();
  await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み', { timeout: 15000 });
  await page.getByRole('button', { name: 'API接続設定' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByText('リクエスト・レスポンス', { exact: true }).click();
  await expect(page.locator('#response-json')).toContainText('datasetVersion');
});

test('mobile layout has no horizontal overflow and preserves seek and direction controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#back-button').click();
  await expect(page.locator('#time-current')).toHaveText('00:03');
  await seek(page, 500);
  await expect(page.locator('#time-current')).toHaveText('08:20');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('keeps the entire playback inside the viewport and aligns prediction metric rows', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => document.fonts.ready);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 900 }, { width: 1100, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const footer = await page.locator('.playback-panel').boundingBox();
    expect(footer.y).toBeGreaterThanOrEqual(0);
    expect(footer.y + footer.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(page.locator('#play')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#speed')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#seek')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    if (viewport.width > 1000) {
      const y = async id => (await page.locator(id).boundingBox()).y;
      expect(Math.abs(await y('#station-eta') - await y('#tunnel-eta'))).toBeLessThan(1);
      expect(Math.abs(await y('#station-eta') - await y('#river-distance'))).toBeLessThan(1);
      expect(Math.abs(await y('#station-distance') - await y('#tunnel-distance'))).toBeLessThan(1);
    }
  }
  await page.locator('.workspace').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('#river-distance')).toBeInViewport();
  await expect(page.locator('#play')).toBeInViewport({ ratio: 1 });
});

test('local requests use the same origin and tunnel color changes emit no Mapbox expression warnings', async ({ page }) => {
  const requests = [], mapWarnings = [];
  page.on('request', request => { if (request.url().includes('/api/position')) requests.push({ url: request.url(), method: request.method() }); });
  page.on('console', message => { if (/Failed to evaluate expression|Could not parse color|toNonPremultipliedRenderColor/.test(message.text())) mapWarnings.push(message.text()); });
  await ready(page);
  await expect(page.locator('.current-marker')).toBeVisible();
  const meta = JSON.parse(fs.readFileSync('public/data/map-data.json', 'utf8')).front;
  const entry = meta.events.find(e => e.type === 'tunnel' && e.target === 'entrance');
  const exit = meta.events.find(e => e.featureId === entry.featureId && e.target === 'exit');
  for (const inside of [true, false, true, false]) {
    await seek(page, inside ? entry.t + 5 : exit.t + 5);
    await expect(page.locator('html')).toHaveAttribute('data-theme', inside ? 'dark' : 'light');
    await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み');
    await page.waitForTimeout(1500); // Let Mapbox workers evaluate reloaded tiles.
  }
  expect(mapWarnings).toEqual([]);
  expect(requests.length).toBeGreaterThanOrEqual(5);
  expect(requests.every(request => request.url.startsWith('http://127.0.0.1:5173/local-api/api/position') && request.method === 'POST')).toBe(true);
});

test('recovers from one Wrangler connection drop without removing the station or tunnel theme', async ({ page }) => {
  await ready(page);
  const meta = JSON.parse(fs.readFileSync('public/data/map-data.json', 'utf8')).front;
  const entry = meta.events.find(e => e.type === 'tunnel' && e.target === 'entrance');
  await seek(page, entry.t + 5);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const station = await page.locator('#station-name').textContent();
  let attempts = 0;
  await page.route('**/local-api/api/position', async route => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 500, contentType: 'text/plain', body: 'Error inside ProxyWorker: Network connection lost.' });
    else await route.continue();
  });
  await seek(page, entry.t + 6);
  await expect.poll(() => attempts).toBe(2);
  await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み');
  await expect(page.locator('#station-name')).toHaveText(station);
  await expect(page.locator('#api-error')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
