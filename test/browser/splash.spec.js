import { test, expect } from '@playwright/test';

// Other tests skip the two-second minimum through navigator.webdriver.
const human = page => page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
// [strokes not yet started, strokes fully drawn, strokes in all]
const strokes = page => page.locator('#loading .splash-logo path').evaluateAll(paths => {
  const styles = paths.map(path => getComputedStyle(path));
  return [styles.filter(style => style.visibility === 'hidden').length, styles.filter(style => style.visibility === 'visible' && parseFloat(style.strokeDashoffset) === 0).length, paths.length];
});

test('the name is written along the font strokes in one second and stays for at least two', async ({ page }) => {
  await human(page); await page.route('https://*.mapbox.com/**', route => route.abort());
  const started = Date.now();
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#loading .splash-logo')).toBeVisible();
  // Centre lines drawn with a round pen, not the outlines of the finished shapes.
  const logo = await page.locator('#loading .splash-logo').evaluate(node => { const style = getComputedStyle(node.querySelector('path'));
    return { width: node.getBoundingClientRect().width, fill: style.fill, pen: [style.strokeWidth, style.strokeLinecap],
      starts: new Set(node.getAnimations({ subtree: true }).map(animation => animation.effect.getComputedTiming().delay)).size,
      end: Math.max(...node.getAnimations({ subtree: true }).map(animation => animation.effect.getComputedTiming().endTime)) }; });
  expect(logo.width).toBeCloseTo(320, 0); expect(logo.fill).toBe('none'); expect(logo.pen).toEqual(['60px', 'round']);
  // The strokes start one after another and the last ends at one second.
  expect(logo.starts).toBeGreaterThan(40); expect(Math.round(logo.end)).toBe(1000);
  await expect.poll(() => strokes(page)).toEqual([0, 49, 49]);
  await expect(page.locator('.journey-workspace')).toBeAttached();
  await expect(page.locator('#loading')).toBeVisible();
  await expect(page.locator('#loading')).toBeHidden();
  expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  await expect(page.locator('#mode-menu')).toBeVisible();
});

test('the logo waits for a slow load to finish', async ({ page }) => {
  await human(page); await page.route('https://*.mapbox.com/**', route => route.abort());
  await page.route('**/data/stations.json', async route => { await new Promise(resolve => setTimeout(resolve, 3500)); await route.continue(); });
  const started = Date.now();
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForTimeout(2600);
  await expect(page.locator('#loading')).toBeVisible();
  expect(await strokes(page)).toEqual([0, 49, 49]);
  await expect(page.locator('#loading')).toBeHidden();
  expect(Date.now() - started).toBeGreaterThanOrEqual(3300);
});
