import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('tarumi-api-endpoint', 'http://localhost:8787/api/position'));
});

test('mobile cue visibility persists while desktop always shows the queue', async ({ page }) => {
  await page.goto('/que');
  await expect(page.locator('#cue-list .cue-primary')).toBeVisible();
  await page.getByRole('button', { name: '次の合図を非表示', exact: true }).click();
  await expect(page.locator('#cue-content')).toBeHidden();
  await expect(page.locator('#mobile-cue-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '次の合図を表示', exact: true })).toBeVisible();
  await expect(page.locator('#play')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#seek')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/mobile-cues-hidden.png' });
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#cue-content')).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1024 });
  await expect(page.locator('#mobile-cue-toggle')).toBeHidden();
  await expect(page.locator('#cue-list .cue-primary')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.locator('#cue-content')).toBeHidden();
  await page.getByRole('button', { name: '次の合図を表示', exact: true }).click();
  await expect(page.locator('#cue-list .cue-primary')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.locator('#mobile-cue-toggle')).toBeInViewport({ ratio: 1 });
  await page.reload();
  await expect(page.locator('#cue-list .cue-primary')).toBeVisible();
  await expect(page.locator('#mobile-cue-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: 'test-results/mobile-cues-visible.png' });
});

test('hiding mobile cues keeps the urgent countdown active and restores the chosen visibility', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.getByRole('button', { name: '次の合図を非表示', exact: true }).click();
  const entry = await page.evaluate(async () => (await (await fetch('/data/map-data.json')).json()).front.events.find(event => event.type === 'tunnel' && event.target === 'entrance'));
  const seek = async time => page.locator('#seek').evaluate((element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, time);
  await seek(entry.t - 5);
  await expect(page.locator('#cue-countdown-focus')).toBeVisible();
  await expect(page.locator('#countdown-target')).toHaveText(`${entry.name}まで`);
  await expect(page.locator('#play')).toBeInViewport({ ratio: 1 });
  await seek(entry.t - 30);
  await expect(page.locator('#cue-countdown-focus')).toBeHidden();
  await expect(page.locator('#cue-content')).toBeHidden();
  await page.getByRole('button', { name: '次の合図を表示', exact: true }).click();
  await expect(page.locator('#cue-list .cue-primary h2')).toHaveText(`${entry.name}まで`);
  await expect(page.locator('#cue-list .cue-primary')).toBeVisible();
  expect(errors).toEqual([]);
});
