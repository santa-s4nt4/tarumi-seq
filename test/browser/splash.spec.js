import { test, expect } from '@playwright/test';

// Other tests skip the two-second minimum through navigator.webdriver.
const human = page => page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
const logo = page => page.locator('#loading .splash-logo path').evaluateAll(paths => { const style = getComputedStyle(paths.at(-1)); return [parseFloat(style.strokeDashoffset), Number(style.fillOpacity)]; });

test('the logo is drawn in one second and stays for at least two', async ({ page }) => {
  await human(page); await page.route('https://*.mapbox.com/**', route => route.abort());
  await page.goto('/', { waitUntil: 'commit' });
  const started = Date.now();
  await expect(page.locator('#loading .splash-logo')).toBeVisible();
  const [offset, fill] = await logo(page);
  expect(offset).toBeGreaterThan(0); expect(fill).toBe(0);
  await expect.poll(() => logo(page)).toEqual([0, 1]);
  expect(await page.locator('#loading .splash-logo path').first().evaluate(path => getComputedStyle(path).animationDuration)).toBe('1s');
  await expect(page.locator('.journey-workspace')).toBeAttached();
  await expect(page.locator('#loading')).toBeVisible();
  await expect(page.locator('#loading')).toBeHidden();
  expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  await expect(page.locator('#mode-menu')).toBeVisible();
});

test('the logo waits for a slow load to finish', async ({ page }) => {
  await human(page); await page.route('https://*.mapbox.com/**', route => route.abort());
  await page.route('**/data/stations.json', async route => { await new Promise(resolve => setTimeout(resolve, 3500)); await route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  const started = Date.now();
  await page.waitForTimeout(2600);
  await expect(page.locator('#loading')).toBeVisible();
  expect(await logo(page)).toEqual([0, 1]);
  await expect(page.locator('#loading')).toBeHidden();
  expect(Date.now() - started).toBeGreaterThanOrEqual(3300);
});
