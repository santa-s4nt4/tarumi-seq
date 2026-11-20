import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRailProfile } from '../../src/rail-elevation.js';
import { LiveTimetable } from '../../src/live-timetable.js';
import { positionAlong } from '../../src/simulation.js';

const read = name => JSON.parse(readFileSync(new URL(`../../public/data/${name}.json`, import.meta.url)));
const railway = read('railway-route'), profile = createRailProfile(railway);
const fleet = new LiveTimetable(read('timetable-reference'), railway, read('stations').stations);
const midnight = Date.parse('2026-11-21T00:00:00+09:00');
const at = seconds => new Date(midnight + Math.round(seconds * 1000));
const currentRun = (id, seconds) => fleet.at(at(seconds).getTime()).active.find(run => run.train.id === id);

async function open(page, seconds, path = '/live/') {
  await page.clock.install({ time: at(seconds - 30) });
  await page.clock.pauseAt(at(seconds));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://*.mapbox.com/**', route => route.abort());
  await page.addInitScript(() => {
    window.watches = 0;
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(ok, bad) { window.fix = ok; window.gpsError = bad; return ++window.watches; },
      clearWatch() { window.fix = null; },
    } });
  });
  await page.goto(path);
  await expect(page.locator('#loading')).toBeHidden();
}

async function emit(page, s, accuracy = 3) {
  const [longitude, latitude] = profile.coordinateAt(s);
  await page.evaluate(coords => window.fix({ timestamp: Date.now(), coords }), { longitude, latitude, accuracy, speed: null });
}

test('full-line overview shows both directions and follows the tapped service without GPS', async ({ page }) => {
  const time = 7 * 3600 + 25 * 60;
  await open(page, time);
  await expect(page.locator('#line-map .line-train')).toHaveCount(3);
  for (const [id, name] of [['5', '下り'], ['10', '上り']]) {
    await page.getByRole('button', { name: `${name} ${id}列車を追従`, exact: true }).click();
    await expect(page.locator('#live-status')).toContainText(`${id}列車`);
    await expect(page.locator('#cue-list .cue-primary h2')).not.toBeEmpty();
    await page.locator('#live-overview').click();
    await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.watches)).toBe(0);
  await page.clock.fastForward(86400000 - time * 1000 + 3 * 3600000);
  await expect(page.locator('#live-status')).toContainText('運行中の列車はありません');
  await expect(page.locator('#live-note')).toContainText('05:37');
  await expect(page.locator('#line-map .line-train')).toHaveCount(0);
});

test('QUE uses the timetable, GPS changes only the selected delay and a refused watch leaves cues running', async ({ page }) => {
  const time = 7 * 3600 + 24 * 60;
  const run = currentRun('5', time);
  await open(page, time, '/que/');
  await page.locator('.train-choice.front').click();
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText('90');
  await page.locator('#live-start').click();
  await emit(page, positionAlong(run, time - 45).s);
  await page.clock.fastForward(3000);
  await emit(page, positionAlong(run, time + 3 - 45).s);
  await expect(page.locator('#live-delay')).toHaveText('推定遅延 +45秒');
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText('132');
  await page.evaluate(() => window.gpsError({ code: 1 }));
  await page.clock.fastForward(4000);
  await expect(page.locator('#gps-status')).toContainText('許可');
  await expect(page.locator('#cue-list .cue-primary strong')).toHaveText('128');
  await page.locator('#live-overview').click();
  await page.locator('.train-choice.back').first().click();
  await expect(page.locator('#live-delay')).toHaveText('時刻表基準');
});

test('a running countdown survives erratic and missing GPS through tunnel entry and exit', async ({ page }) => {
  const run = currentRun('1', 6.5 * 3600);
  const tunnel = run.tunnels[1];
  const start = Math.ceil(tunnel.entryT) - 8;
  await open(page, start);
  await page.getByRole('button', { name: '下り 1列車を追従', exact: true }).click();
  await expect(page.locator('#countdown-seconds')).toHaveText('8');
  await page.locator('#live-start').click();
  await emit(page, run.stops[0].s);
  await page.clock.fastForward(3000);
  await emit(page, run.stops[0].s + 20);
  await expect(page.locator('#countdown-seconds')).toHaveText('5');
  await page.clock.fastForward(6000);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  for (const offset of [0, 3]) {
    await page.clock.fastForward(3000);
    await emit(page, run.stops[0].s + offset);
  }
  await expect(page.locator('#live-delay')).toHaveText('時刻表基準');
  await page.clock.fastForward(Math.floor((tunnel.exitT - start - 15 - 5) * 1000));
  await expect(page.locator('#countdown-target')).toContainText('終了');
  await expect(page.locator('#countdown-seconds')).toHaveText(/^[56]$/);
  await page.clock.fastForward(6500);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#cue-countdown-focus')).toBeHidden();
});

test('playback opens from the realtime menu and posts to the local API in development', async ({ page }) => {
  await open(page, 3 * 3600, '/que/');
  await page.getByRole('button', { name: 'メニューを開く' }).click();
  const request = page.waitForResponse(r => r.url().endsWith('/local-api/api/position') && r.request().method() === 'POST');
  await page.getByRole('link', { name: '記録・ダイヤを再生' }).click();
  await page.clock.resume();
  const response = await request;
  expect(response.status()).toBe(200);
  expect((await response.json()).next.station.name).toBeTruthy();
  await expect(page.locator('#play')).toBeEnabled();
});

test('one active QUE service follows automatically and returns to the overview after the terminal countdown', async ({ page }) => {
  // 41 is the final train, due at Motosu at 23:29.
  await open(page, 23 * 3600 + 28 * 60 + 52, '/que/');
  await expect(page.locator('#live-status')).toContainText('41列車');
  await expect(page.locator('#countdown-target')).toHaveText('本巣駅まで');
  await expect(page.locator('#countdown-seconds')).toHaveText('8');
  await page.clock.fastForward(8000);
  await expect(page.locator('#countdown-seconds')).toHaveText('0');
  await page.clock.fastForward(500);
  await expect(page.locator('#live-note')).toContainText('本日の運行は終了');
  await expect(page.locator('#cue-countdown-focus')).toBeHidden();
});

test('QUE selects a train from the diagram and waits for exactly the chosen boarding and alighting stations', async ({ page }) => {
  const now = 7 * 3600 + 25 * 60 + 50;
  await open(page, now, '/que/');
  await page.getByRole('button', { name: 'ダイヤ・区間を選ぶ' }).click();
  await page.locator('#simulation-direction').selectOption('front');
  await page.locator('#simulation-departure').selectOption('3');
  const track = page.locator('#simulation-diagram [data-train="5"] .diagram-hit');
  await expect(track).toBeVisible();
  const hit = await track.evaluate(el => {
    const { x, y } = el.getPointAtLength(el.getTotalLength() * 0.74).matrixTransform(el.getScreenCTM());
    return { x, y };
  });
  await page.mouse.click(hit.x, hit.y);
  await expect(page.locator('#simulation-departure')).toHaveValue('5');
  await page.locator('#simulation-station').selectOption('6');
  await page.locator('#simulation-end-station').selectOption('8');
  await expect(page.locator('#simulation-end-station option[value="6"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'この区間の発車を待つ' }).click();
  await expect(page.locator('#live-status')).toContainText('北方真桑 → 糸貫 · 出発待ち');
  await expect(page.locator('.cue-overlay')).toBeHidden();
  await page.clock.fastForward(11000);
  await expect(page.locator('#live-status')).toContainText('北方真桑 → 糸貫 · 追従中');
  await expect(page.locator('#cue-list h2')).toHaveText(['モレラ岐阜駅まで', '糸貫駅まで']);
  await page.clock.fastForward(262000);
  await expect(page.locator('#countdown-target')).toHaveText('糸貫駅まで');
  await page.clock.fastForward(8000);
  await expect(page.locator('#live-note')).toContainText('北方真桑 → 糸貫 の合図は終了');
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(0);
});

test('QUE can replay a holiday train section outside service hours, including an intermediate final station', async ({ page }) => {
  await open(page, 23 * 3600 + 51 * 60, '/que/');
  await page.getByRole('button', { name: 'ダイヤ・区間を選ぶ' }).click();
  await page.locator('#simulation-direction').selectOption('back');
  await page.locator('#simulation-day').selectOption('weekday');
  await expect(page.locator('#simulation-departure option[value="1002"]')).toHaveCount(0);
  await page.locator('#simulation-day').selectOption('holiday');
  await page.locator('#simulation-departure').selectOption('1002');
  await page.locator('#simulation-station').selectOption('8');
  await page.locator('#simulation-end-station').selectOption('6');
  await expect(page.locator('#simulation-follow')).toBeDisabled();
  await page.getByRole('button', { name: 'この区間を再生' }).click();
  await expect(page.locator('body')).toHaveClass(/timetable-mode/);
  await expect(page.locator('#sample-count')).toContainText('1002列車 · 糸貫 → 北方真桑');
  const max = await page.locator('#seek').getAttribute('max');
  await page.locator('#seek').evaluate((el, max) => { el.value = max; el.dispatchEvent(new Event('input', { bubbles: true })); }, max);
  await expect(page.locator('#cue-status')).toContainText('北方真桑駅に到着');
  await expect(page.locator('#cue-list .cue-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#sample-count')).toContainText('1002列車 · 糸貫 → 北方真桑');
});
