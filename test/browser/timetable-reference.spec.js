import { test, expect } from '@playwright/test';

test('playback can compare a selected timetable, pause the notes and return to recorded GPS', async ({ page }) => {
  await page.goto('/que/?mode=playback');
  await page.getByRole('button', { name: 'メニューを開く' }).click();
  await page.locator('#simulation-button').click();
  await page.locator('#simulation-departure').selectOption('17');
  await page.locator('#simulation-start').click();
  await page.locator('#play[aria-pressed="true"]').click();
  const seek = time => page.locator('#seek').evaluate((element, value) => {
    element.value = value; element.dispatchEvent(new Event('input', { bubbles: true }));
  }, time);
  await seek(11 * 3600 + 27 * 60);
  const note = page.locator('#cue-list .cue-card[data-type="station"] .cue-schedule').first();
  await expect(note).toContainText('ダイヤ着 11:29:30 *');
  await expect(note).toContainText('見込との差 ±0秒');
  await seek(11 * 3600 + 29 * 60 + 30);
  await expect(note).toContainText('差 —（駅付近・停車中）');
  await page.getByRole('button', { name: 'メニューを開く' }).click();
  await page.locator('#simulation-button').click();
  await page.locator('#simulation-restore').click();
  await expect(page.locator('#seek')).toHaveAttribute('aria-label', 'GPSの再生位置');
});

test('a missing realtime timetable offers retry and recovers without requesting GPS', async ({ page }) => {
  await page.route('**/data/timetable-reference.json', route => route.fulfill({ status: 503 }));
  await page.goto('/live/');
  await expect(page.locator('#loading-message')).toContainText('時刻表・路線データを読み込めませんでした');
  await page.unroute('**/data/timetable-reference.json');
  await page.locator('#reload-data').click();
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#live-clock')).toContainText('JST');
});
