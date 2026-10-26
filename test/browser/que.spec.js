import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tarumi-api-endpoint', 'http://localhost:8787/api/position'));
});

async function captureMapMarkers(page) {
  await page.evaluate(async () => {
    const source = await (await fetch('/src/main.js')).text();
    const path = source.match(/from "([^"]*\/mapbox-gl\.js[^\"]*)"/)[1];
    const gl = (await import(path)).default;
    const jumpTo = gl.Map.prototype.jumpTo;
    gl.Map.prototype.jumpTo = function (...args) {
      window.testMap = this;
      gl.Map.prototype.jumpTo = jumpTo;
      return jumpTo.apply(this, args);
    };
    window.testMarkers = new Set();
    const setLngLat = gl.Marker.prototype.setLngLat;
    gl.Marker.prototype.setLngLat = function (...args) {
      window.testMarkers.add(this);
      if (this.getElement().classList.contains('current-marker')) window.testMarker = this;
      return setLngLat.apply(this, args);
    };
    window.markerOpacities = [];
    const element = document.querySelector('.current-marker');
    new MutationObserver(() => { if (element.style.opacity) window.markerOpacities.push(Number(element.style.opacity)); }).observe(element, { attributes: true, attributeFilter: ['style'] });
  });
}

test('railway, tunnel and bridge height layers load without Mapbox style errors', async ({ page }) => {
  const styleErrors = [];
  page.on('pageerror', error => styleErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /line-z-offset|expression|bridge|tunnel|style/i.test(message.text())) styleErrors.push(message.text());
  });
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await captureMapMarkers(page);
  await page.locator('#seek').evaluate(el => { el.value = 1200; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => Boolean(window.testMap))).toBe(true);
  await page.evaluate(() => {
    window.mapStyleErrors = [];
    window.testMap.on('error', event => window.mapStyleErrors.push(event.error?.message || String(event.error)));
  });
  await expect.poll(() => page.evaluate(() => window.testMap.getSource('bridges')?._data?.features?.length ?? 0)).toBeGreaterThan(0);
  const layers = await page.evaluate(() => {
    const style = window.testMap.getStyle();
    return ['route', 'travelled', 'tunnels', 'bridges'].map(id => ({
      id,
      lineMetrics: style.sources[id]?.lineMetrics,
      zOffset: window.testMap.getLayoutProperty(id, 'line-z-offset'),
    }));
  });
  for (const layer of layers) {
    expect(layer.lineMetrics, `${layer.id} source`).toBe(true);
    expect(layer.zOffset, `${layer.id} line height`).toEqual(expect.arrayContaining(['at-interpolated']));
  }
  await page.locator('#back-button').click();
  await expect(page.locator('.current-marker')).toBeVisible();
  expect(await page.evaluate(() => window.mapStyleErrors)).toEqual([]);
  expect(styleErrors).toEqual([]);
});

test('an occluded position switches to the closest bird view and stays stable until the view clears', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Keep the known terrain-occlusion scenario at its original zoom.
  await page.addInitScript(() => localStorage.setItem('tarumi-que-zoom', JSON.stringify({version:2,normal:17,bird:19})));
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await captureMapMarkers(page);
  await page.locator('#seek').evaluate(el => { el.value = 1497; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => Boolean(window.testMap && window.testMarker))).toBe(true);
  const pitch = () => page.evaluate(() => window.testMap.getPitch());
  await expect.poll(pitch, { timeout: 15000 }).toBeLessThan(0.01);
  expect(await page.evaluate(() => window.testMap.getZoom())).toBeCloseTo(19, 3);
  expect(await page.evaluate(() => window.markerOpacities.some(opacity => opacity <= 0.21))).toBe(true);
  await expect.poll(() => page.locator('.current-marker').evaluate(el => Number(getComputedStyle(el).opacity))).toBeCloseTo(1, 2);
  const samples = await page.evaluate(() => new Promise(resolve => {
    const samples = [], start = performance.now();
    const frame = () => {
      const box = document.querySelector('.current-marker').getBoundingClientRect();
      samples.push({ x: box.x, y: box.y, pitch: window.testMap.getPitch(), zoom: window.testMap.getZoom() });
      if (performance.now() - start < 1500) requestAnimationFrame(frame);
      else resolve(samples);
    };
    requestAnimationFrame(frame);
  }));
  for (const key of ['x', 'y', 'pitch', 'zoom']) {
    const values = samples.map(sample => sample[key]);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.1);
  }
  await page.screenshot({ path: 'test-results/que-bird-stable.png' });
  await page.locator('#seek').evaluate(el => { el.value = el.min; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(pitch, { timeout: 10000 }).toBeCloseTo(72, 2);
  await expect.poll(() => page.evaluate(() => window.testMap.getZoom())).toBeCloseTo(17, 2);
  expect(errors).toEqual([]);
});

test('moving current position, station names and tunnel markers match the rendered map without pixel snapping', async ({ page }) => {
  // Keep the known terrain-occlusion scenario at its original zoom.
  await page.addInitScript(() => localStorage.setItem('tarumi-que-zoom', JSON.stringify({version:2,normal:17,bird:19})));
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await captureMapMarkers(page);
  await page.locator('#back-button').click();
  await page.locator('#front-button').click();
  await page.locator('#seek').evaluate(el => { el.value = 1497; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => Boolean(window.testMap && window.testMarker))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.testMap.getPitch()), { timeout: 15000 }).toBeLessThan(0.01);
  await expect.poll(() => page.evaluate(() => window.testMap.areTilesLoaded())).toBe(true);
  await page.evaluate(() => {
    window.markerProjectionChecks = [];
    window.testMap.on('render', () => {
      const mapBox = document.getElementById('map').getBoundingClientRect();
      for (const marker of window.testMarkers) {
        const element = marker.getElement();
        if (!element.isConnected || element.hidden) continue;
        const point = window.testMap.project(marker.getLngLat(), marker.getAltitude());
        if (Math.abs(point.x) > 1e6 || Math.abs(point.y) > 1e6) continue;
        const box = element.getBoundingClientRect();
        const current = element.classList.contains('current-marker');
        const station = element.classList.contains('station-marker');
        const actualX = box.x - mapBox.x + (current ? box.width / 2 : 14);
        const actualY = box.y - mapBox.y + (current || station ? box.height / 2 : box.height);
        window.markerProjectionChecks.push({ kind: current ? 'current' : station ? 'station' : 'tunnel', error: Math.hypot(actualX - point.x, actualY - point.y) });
      }
    });
  });
  await page.locator('#speed').selectOption('4');
  await page.locator('#play').click();
  await page.waitForTimeout(1600);
  await page.locator('#play').click();
  const checks = await page.evaluate(() => window.markerProjectionChecks);
  for (const kind of ['current', 'station', 'tunnel']) {
    const errors = checks.filter(check => check.kind === kind).map(check => check.error);
    expect(errors.length).toBeGreaterThan(5);
    expect(Math.max(...errors)).toBeLessThan(0.1);
  }
});

test('front playback stays in bird view while the rail is buried and returns on a clear section', async ({ page }) => {
  // Keep the known terrain-occlusion scenario at its original zoom.
  await page.addInitScript(() => localStorage.setItem('tarumi-que-zoom', JSON.stringify({version:2,normal:17,bird:19})));
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await captureMapMarkers(page);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/main.js')).text();
    const { OcclusionCamera } = await import(source.match(/from "([^"]*\/camera.js[^\"]*)"/)[1]);
    const update = OcclusionCamera.prototype.update;
    window.modeTransitions = [];
    let previous;
    OcclusionCamera.prototype.update = function (hidden, now) {
      const value = update.call(this, hidden, now);
      const mode = this.target === this.birdView ? 'bird' : 'normal';
      if (previous !== mode) window.modeTransitions.push({ mode, time: Number(document.querySelector('#seek').value) });
      previous = mode;
      return value;
    };
  });
  await page.locator('#seek').evaluate(el => { el.value = 1320; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => window.modeTransitions.at(-1)?.mode), { timeout: 15000 }).toBe('bird');
  await expect.poll(() => page.evaluate(() => window.testMap?.getPitch()), { timeout: 15000 }).toBeLessThan(0.01);
  await page.evaluate(() => { window.modeTransitions = []; });
  await page.locator('#speed').selectOption('4');
  await page.locator('#play').click();
  await expect.poll(() => page.locator('#seek').evaluate(el => Number(el.value)), { timeout: 25000 }).toBeGreaterThan(1400);
  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => window.testMap.getPitch())).toBeLessThan(0.01);
  const transitions = await page.evaluate(() => window.modeTransitions);
  expect(transitions.map(item => item.mode), JSON.stringify(transitions)).not.toContain('normal');
  await page.locator('#seek').evaluate(el => { el.value = 1800; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => window.testMap.getPitch())).toBeCloseTo(72, 2);
  await expect.poll(() => page.locator('.current-marker').evaluate(el => Number(getComputedStyle(el).opacity))).toBeCloseTo(1, 2);
});

test('zoom buttons adjust both views, persist settings and fit on mobile', async ({ page }) => {
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await captureMapMarkers(page);
  await page.locator('#que-mode-normal').click();
  await page.locator('#que-zoom-button').click();
  await expect(page.locator('#que-normal-zoom')).toHaveText('19.0');
  await page.locator('#que-normal-out').click();
  await expect(page.locator('#que-normal-zoom')).toHaveText('18.5');
  // Terrain collision avoidance can reduce the requested zoom at this position.
  await expect.poll(() => page.evaluate(() => window.testMap?.getZoom())).toBeGreaterThan(17);
  await expect.poll(() => page.evaluate(() => window.testMap.getZoom())).toBeLessThanOrEqual(18.50001);
  await page.locator('#que-bird-in').click();
  await expect(page.locator('#que-bird-zoom')).toHaveText('19.5');
  await page.locator('#done-que-zoom').click();
  await page.locator('#que-mode-bird').click();
  await page.locator('#seek').evaluate(el => { el.value = 1497; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => window.testMap.getPitch()), { timeout: 15000 }).toBeLessThan(0.01);
  await expect.poll(() => page.evaluate(() => window.testMap.getZoom())).toBeCloseTo(19.5, 2);
  await page.locator('#que-zoom-button').click();
  await page.locator('#que-bird-in').click();
  await expect(page.locator('#que-bird-in')).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.testMap.getZoom())).toBeCloseTo(20, 2);
  expect(await page.evaluate(() => window.testMap.getPitch())).toBeCloseTo(0, 2);
  await page.locator('#que-normal-out').click();
  await expect(page.locator('#que-normal-zoom')).toHaveText('18.0');
  await page.reload();
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#que-zoom-button').click();
  await expect(page.locator('#que-normal-zoom')).toHaveText('18.0');
  await expect(page.locator('#que-bird-zoom')).toHaveText('20.0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/que-zoom-mobile.png' });
  await page.locator('#reset-que-zoom').click();
  await expect(page.locator('#que-normal-zoom')).toHaveText('19.0');
  await expect(page.locator('#que-bird-zoom')).toHaveText('19.0');
  await page.locator('#done-que-zoom').click();
  await page.goto('/console');
  await expect(page.locator('#que-zoom-button')).toHaveCount(0);
});

test('queue view shows API events and updates countdown with playback', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/que');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('木知原駅まで', { timeout: 15000 });
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(3);
  await expect(page.locator('.readout')).toBeHidden();
  await expect(page.locator('#follow-map')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.current-marker')).toBeVisible();
  const eta = Number(await page.locator('#cue-list .cue-primary strong').textContent());
  await page.locator('#speed').selectOption('4');
  await page.locator('#play').click();
  await expect.poll(async () => Number(await page.locator('#cue-list .cue-primary strong').textContent())).toBeLessThan(eta);
  await page.locator('#play').click();
  const paused = await page.locator('#cue-list .cue-primary strong').textContent();
  await page.waitForTimeout(250);
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText(paused);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/que-desktop.png' });
  expect(errors).toEqual([]);
});

test('tunnel checkpoints lead the queue, reuse one card through passage and promote the following checkpoint', async ({ page }) => {
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.locator('#speed').selectOption('4');
  const entry = await page.evaluate(async () => (await (await fetch('/data/map-data.json')).json()).front.events.find(event => event.type === 'tunnel' && event.target === 'entrance'));
  await page.locator('#seek').evaluate((el, time) => { el.value = time; el.dispatchEvent(new Event('input', { bubbles: true })); }, entry.t - 2);
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText(`${entry.name}まで`);
  await page.evaluate(() => { window.firstTunnelCard = document.querySelector('#cue-list .cue-primary'); });
  const card = page.locator(`#cue-list [data-key="tunnel:${entry.featureId}"]`);
  await expect(card.locator('.cue-kind-icon svg')).toHaveCount(1);
  await expect(page.locator('#cue-countdown-focus')).toBeVisible();
  await expect(card).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect(card.locator('h2')).toHaveText(`${entry.name}通過まで`);
  expect(await page.evaluate(() => window.firstTunnelCard === document.querySelector('#cue-list .cue-primary'))).toBe(true);
  await expect(card).toHaveCount(0, { timeout: 12000 });
  await page.locator('#play').click();
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('トンネル4まで');
  await page.screenshot({ path: 'test-results/que-checkpoints-tunnel.png' });
});

test('station dwell freezes other cards across API refreshes and departure resumes the queue', async ({ page }) => {
  let requests = 0;
  page.on('response', response => { if (response.url().includes('/api/position') && response.ok()) requests++; });
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.locator('#seek').evaluate(el => { el.value = 470; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText('0');
  await expect(page.locator('#cue-status')).toHaveText('木知原駅で停車中');
  const other = page.locator('#cue-list .cue-card:not(.cue-primary) strong');
  const frozen = await other.allTextContents(), initialRequests = requests;
  await page.locator('#speed').selectOption('4');
  await page.locator('#play').click();
  await page.waitForTimeout(6000);
  expect(requests).toBeGreaterThan(initialRequests);
  expect(await other.allTextContents()).toEqual(frozen);
  await page.locator('#speed').selectOption('16');
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText('谷汲口駅まで', { timeout: 6000 });
  await page.locator('#play').click();
  expect(Number(await page.locator('#cue-list .cue-primary strong').textContent())).toBeLessThan(Number(frozen[0]));
});

test('fixed perspectives fade terrain-hidden labels and bird view persists across seeks and reload', async ({ page }) => {
  // Keep the known terrain-occlusion scenario at its original zoom.
  await page.addInitScript(() => localStorage.setItem('tarumi-que-zoom', JSON.stringify({version:2,normal:17,bird:19})));
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await captureMapMarkers(page);
  await page.locator('#que-mode-normal').click();
  await page.locator('#seek').evaluate(el => { el.value = 1497; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => window.testMap?.getPitch())).toBeCloseTo(72, 2);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.tunnel-marker')].some(element => !element.hidden && element.querySelector('.tunnel-marker-label') && Number(element.style.opacity) <= 0.21 && element.style.opacity !== ''))).toBe(true);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.station-marker')].some(element => !element.hidden && Number(element.style.opacity) <= 0.21 && element.style.opacity !== ''))).toBe(true);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.testMap.getPitch())).toBeCloseTo(72, 2);
  await page.locator('#que-mode-bird').click();
  await expect.poll(() => page.evaluate(() => window.testMap.getPitch())).toBeLessThan(0.01);
  await page.locator('#seek').evaluate(el => { el.value = el.min; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.testMap.getPitch())).toBeCloseTo(0, 2);
  await page.reload();
  await expect(page.locator('.current-marker')).toBeVisible();
  await expect(page.locator('#que-mode-bird')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#que-mode-auto').click();
  await expect(page.locator('#que-mode-auto')).toHaveAttribute('aria-pressed', 'true');
});

test('queue remains usable on mobile and console retains the existing viewer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/que/');
  await expect(page.locator('#cue-list .cue-primary')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator('#play')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#seek')).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => {
    const train = await page.locator('.current-marker').boundingBox();
    const cues = await page.locator('.cue-overlay').boundingBox();
    return train && cues ? train.y + train.height < cues.y : false;
  }).toBe(true);
  await page.locator('#back-button').click();
  await expect(page.locator('#time-current')).toHaveText('00:03');
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/que-mobile.png' });
  await page.getByRole('link', { name: 'CONSOLE', exact: true }).click();
  await expect(page).toHaveURL(/\/console\/?$/);
  await expect(page.locator('.readout')).toBeVisible();
  await expect(page.locator('#station-name')).toHaveText('木知原', { timeout: 15000 });
});

test('queue clears stale cues on API failure and offers retry', async ({ page }) => {
  await page.route('**/api/position', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.goto('/que');
  await expect(page.locator('#cue-status')).toHaveText('API 接続エラー');
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
  await expect(page.locator('#cue-retry')).toBeVisible();
  await page.unroute('**/api/position');
  await page.locator('#cue-retry').click();
  await expect(page.locator('#cue-list .cue-primary')).toBeVisible({ timeout: 15000 });
});

test('queue camera stays locked against mouse input and tracks seeks and direction switches', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tarumi-que-zoom', JSON.stringify({version:2,normal:17,bird:19})));
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await captureMapMarkers(page);
  await page.locator('#back-button').click();
  await page.locator('#front-button').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.testMap && window.testMarker))).toBe(true);
  await page.locator('#que-mode-normal').click();
  await expect.poll(() => page.evaluate(() => window.testMap.getPitch())).toBeCloseTo(72, 2);
  // Terrain can shift the projected center by a few pixels. Follow must keep
  // the camera's geographic center at the GPS coordinate, not fight that shift.
  const centered = () => page.evaluate(() => window.testMap.getCenter().distanceTo(window.testMarker.getLngLat()));
  const view = () => page.evaluate(() => [window.testMap.getZoom(), window.testMap.getPitch(), window.testMap.getBearing()]);
  const before = await view();
  await expect.poll(centered).toBeLessThan(0.01);
  await page.mouse.move(300, 400);
  await page.mouse.down();
  await page.mouse.move(500, 450, { steps: 10 });
  await expect(page.locator('#follow-map')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.up();
  await expect(page.locator('#follow-map')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(centered).toBeLessThan(0.01);
  await page.mouse.wheel(0, -1000);
  await page.mouse.dblclick(300, 400);
  await expect.poll(centered).toBeLessThan(0.01);
  expect(await view()).toEqual(before);
  await expect(page.locator('.map-tools')).toBeHidden();
  await page.locator('#play').click();
  await expect(page.locator('#follow-map')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(centered).toBeLessThan(0.01);
  await page.locator('#play').click();
  await page.locator('#seek').evaluate(el => { el.value = 1000; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(centered).toBeLessThan(0.01);
  await page.locator('#back-button').click();
  await page.waitForTimeout(2000);
  await expect.poll(centered).toBeLessThan(0.01);
});

test('tunnel viewer turns black, shows portals and speed, then returns to daylight', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const meta = JSON.parse(readFileSync('public/data/map-data.json', 'utf8')).front;
  const entry = meta.events.find(e => e.type === 'tunnel' && e.target === 'entrance');
  const exit = meta.events.find(e => e.featureId === entry.featureId && e.target === 'exit');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Failed to evaluate expression|Could not parse color|Error:/.test(message.text())) errors.push(message.text()); });
  await page.goto('/que');
  await expect(page.locator('#map-train-speed')).not.toHaveText('—', { timeout: 15000 });
  await expect(page.locator('.map-speed-card')).toBeVisible();
  const cue = await page.locator('#cue-list .cue-primary').boundingBox();
  const speed = await page.locator('.map-speed-card').boundingBox();
  expect(speed.width).toBe(cue.width);
  const seek = async t => page.locator('#seek').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, t);
  await seek(entry.t + 5);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#map-tunnel-banner')).toHaveText(`${entry.name}内を走行中`);
  await expect(page.locator('.tunnel-marker.entrance').filter({ hasText: entry.name })).toBeVisible();
  await expect(page.locator('#cue-list')).not.toContainText(/入口|出口/);
  expect((await page.locator('.tunnel-marker-label').allTextContents()).join('')).not.toMatch(/入口|出口/);
  await expect.poll(() => page.locator('.header').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)');
  await expect(page.locator('#map-train-speed')).toHaveText(await page.locator('#train-speed').textContent());
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'test-results/que-tunnel-dark.png' });
  await seek(exit.t + 1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#map-tunnel-banner')).toBeHidden();
  expect(errors).toEqual([]);
});
