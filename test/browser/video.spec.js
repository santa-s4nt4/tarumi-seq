import { test, expect } from '@playwright/test';

test('video mode embeds each direction, survives reload and removes the player when returning to the map', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://www.youtube.com/embed/**', route => route.fulfill({contentType:'text/html',body:'<html><body style="background:black;color:white">YouTube embed fixture</body></html>'}));
  await page.goto('/que');
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#que-zoom-button').click();
  await expect(page.locator('#que-normal-zoom')).toHaveText('19.0');
  await page.locator('#que-mode-video').click();
  await page.locator('#done-que-zoom').click();
  await expect(page.locator('#que-video')).toBeVisible();
  await expect(page.locator('#que-video')).toHaveAttribute('src', /embed\/m-jjJKsWI24\?/);
  await expect(page.locator('#map')).not.toBeVisible();
  const frame = await page.locator('#que-video').boundingBox(), panel = await page.locator('.map-panel').boundingBox();
  expect(frame.width).toBeCloseTo(panel.width, 0); expect(frame.height).toBeCloseTo(panel.height, 0);
  await page.locator('#back-button').click();
  await expect(page.locator('#que-video')).toHaveAttribute('src', /embed\/7O6dZcTG2mQ\?/);
  await page.reload();
  await expect(page.locator('#que-video')).toBeVisible();
  await expect(page.locator('#que-video')).toHaveAttribute('src', /embed\/m-jjJKsWI24\?/);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#que-zoom-button').click();
  await expect(page.locator('#que-mode-video')).toHaveAttribute('aria-pressed','true');
  await page.locator('#que-mode-normal').click();
  await page.locator('#done-que-zoom').click();
  await expect(page.locator('#que-video')).toHaveCount(0);
  await expect(page.locator('#map')).toBeVisible();
  expect(errors).toEqual([]);
});

test('updates old saved zooms to 19 and switches the embedded direction for timetable playback', async ({ page }) => {
  await page.addInitScript(()=>{if(!localStorage.getItem('tarumi-que-zoom'))localStorage.setItem('tarumi-que-zoom',JSON.stringify({normal:17,bird:19}));});
  await page.route('https://www.youtube.com/embed/**', route=>route.fulfill({contentType:'text/html',body:'<html><body>Video</body></html>'}));
  await page.goto('/que'); await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#que-zoom-button').click();
  await expect(page.locator('#que-normal-zoom')).toHaveText('19.0');
  await page.locator('#que-mode-video').click(); await page.locator('#done-que-zoom').click();
  await page.locator('#simulation-button').click();
  await page.locator('#simulation-direction').selectOption('back');
  await page.locator('#simulation-start').click();
  await expect(page.locator('#que-video')).toHaveAttribute('src', /embed\/7O6dZcTG2mQ\?/);
  await page.locator('#que-zoom-button').click(); await page.locator('#reset-que-zoom').click();
  await expect(page.locator('#que-video')).toHaveCount(0);
  await expect(page.locator('#que-normal-zoom')).toHaveText('19.0');
  await expect(page.locator('#que-bird-zoom')).toHaveText('19.0');
});
