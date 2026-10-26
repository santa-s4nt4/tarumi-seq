import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tarumi-api-endpoint', 'http://localhost:8787/api/position'));
});

async function setup(page) {
  await page.goto('/que');
  await expect(page.locator('.current-marker')).toBeVisible();
  const entry = await page.evaluate(async () => (await (await fetch('/data/map-data.json')).json()).front.events.find(event => event.type === 'tunnel' && event.target === 'entrance'));
  return entry.t;
}
async function seek(page, time) {
  await page.locator('#seek').evaluate((element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, time);
}

test('crossfades a real map frame and UI colors in both theme directions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const entry = await setup(page);
  await seek(page, entry + 5);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.map-theme-fade')).toHaveCount(1);
  const hasFrame = await page.locator('.map-theme-fade').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return pixels[3] > 0;
  });
  expect(hasFrame).toBe(true);
  await expect.poll(() => page.locator('.header').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(255, 255, 255)');
  await expect.poll(() => page.locator('.header').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(0, 0, 0)');
  await expect(page.locator('.map-theme-fade')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/theme-dark.png' });
  await seek(page, entry - 30);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.map-theme-fade')).toHaveCount(1);
  await expect.poll(() => page.locator('.header').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
  await expect(page.locator('.map-theme-fade')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rapid seeks cancel the previous fade and leave no stale frame', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const entry = await setup(page);
  await seek(page, entry + 5);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.map-theme-fade')).toHaveCount(1);
  await seek(page, entry - 30);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await seek(page, entry + 5);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.map-theme-fade')).toHaveCount(0);
  await expect.poll(() => page.locator('.header').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(0, 0, 0)');
  expect(errors).toEqual([]);
});

test('reduced-motion preference skips the animated map layer', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const entry = await setup(page);
  await seek(page, entry + 5);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.map-theme-fade')).toHaveCount(0);
  await expect(page.locator('.header')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
});
