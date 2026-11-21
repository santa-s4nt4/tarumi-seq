import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route('https://*.mapbox.com/**', route => route.abort());
});

const names = page => page.locator('.custom-station').evaluateAll(nodes => nodes
  .filter(node => getComputedStyle(node).visibility === 'visible').map(node => node.textContent));

async function checkFit(page, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const scroll = page.locator('.station-timeline-scroll');
  expect(await scroll.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await scroll.evaluate(node => { node.scrollLeft = 100; });
  expect(await scroll.evaluate(node => node.scrollLeft)).toBe(0);
  for (const selector of ['.range-in', '.range-out', '.custom-station.range-start', '.custom-station.range-end']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  const boxes = await page.locator('.custom-station:is(.range-start,.range-end)').evaluateAll(nodes => nodes.map(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const { left, right, top, bottom } = range.getBoundingClientRect(); return { left, right, top, bottom };
  }));
  expect(boxes[0].right <= boxes[1].left || boxes[0].bottom <= boxes[1].top).toBe(true);
}

for (const width of [320, 390, 760, 844]) test(`mobile ${width}px fits all stations and labels only the moving range endpoints`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
  await page.goto('/custom/?train=23&day=weekday');
  await expect(page.locator('#loading')).toBeHidden();
  await expect.poll(() => names(page)).toEqual(['大垣', '樽見']);
  await checkFit(page, width);
  await expect(page.locator('.timeline-tunnel')).toHaveCount(9);
  await expect(page.locator('.station-tunnels')).toBeHidden();
  await expect(page.locator('.timeline-tunnel-key')).toHaveCount(0);

  const handle = page.locator('.range-in'), box = await handle.boundingBox();
  const track = await page.locator('.station-timeline').boundingBox();
  // Drag from the edge of the handle: retain its grab offset and snap to Motosu.
  await page.mouse.move(box.x + box.width / 2 - 4, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(track.x + track.width * 8 / 18 - 4, box.y + box.height / 2); await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuetext', '本巣');
  await expect.poll(() => names(page)).toEqual(['本巣', '樽見']);
  await checkFit(page, width);

  await page.locator('.range-out').focus(); await page.keyboard.press('Home');
  await expect.poll(() => names(page)).toEqual(['本巣', '織部']);
  await checkFit(page, width);
  await expect(page).toHaveURL(/from=9&to=10/);
  await page.reload(); await expect(page.locator('#loading')).toBeHidden();
  await expect.poll(() => names(page)).toEqual(['本巣', '織部']);
  await checkFit(page, width);
  await page.screenshot({ path: `test-results/mobile-range-${width}.png` });

  // Switching out of the phone layout restores every desktop station name.
  await page.setViewportSize({ width: 1440, height: 1024 });
  await expect.poll(() => names(page)).toHaveLength(19);
  await expect(page.locator('.timeline-tunnel:visible')).toHaveCount(9);
});

test('reverse range labels follow IN/OUT without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/custom/?train=18&day=holiday&from=19&to=10');
  await expect(page.locator('#loading')).toBeHidden();
  await expect.poll(() => names(page)).toEqual(['樽見', '織部']);
  await checkFit(page, 320);
  await page.locator('.range-out').focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => names(page)).toEqual(['樽見', '本巣']);
  await checkFit(page, 320);
});
