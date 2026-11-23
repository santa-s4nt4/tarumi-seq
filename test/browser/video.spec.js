import { test, expect } from '@playwright/test';

// A stand-in for the YouTube IFrame API whose position the test controls.
const youtube = `window.YT = { Player: function (element, options) {
  const frame = document.createElement('iframe'); frame.id = 'stub-player'; element.replaceWith(frame);
  const stub = window.stub = { time: 0, state: 2, videoId: options.videoId, destroyed: false, change(state) { stub.state = state; options.events.onStateChange({ data: state }); } };
  Object.assign(this, { getCurrentTime: () => stub.time, getDuration: () => 1800, getPlayerState: () => stub.state, getPlaybackRate: () => 1,
    playVideo() { stub.state = 1; }, pauseVideo() { stub.state = 2; }, destroy() { stub.destroyed = true; frame.remove(); } });
  setTimeout(() => options.events.onReady({ target: this }));
} }; window.onYouTubeIframeAPIReady();`;
const picture = page => page.locator('.video-stage canvas').evaluate(canvas => canvas.toDataURL());

test('VIDEO is a third mode whose cues follow the YouTube position without a seek bar', async ({ page }) => {
  await page.route('https://*.mapbox.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/javascript', body: youtube }));
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"/>' }));
  await page.goto('/'); await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.mode-tabs [role=tab]')).toHaveText(['LIVE', 'CUSTOM', 'VIDEO']);
  await page.getByRole('tab', { name: 'VIDEO' }).click();
  await expect(page.locator('#video-service [role=option]')).toHaveText(['本巣発　樽見行き', '樽見発　本巣行き']);
  await expect(page.locator('#video-service [role=option] img')).toHaveCount(2);
  await expect.poll(() => page.locator('#video-service img').evaluateAll(images => images.map(image => [image.src, image.complete && image.naturalWidth > 0, image.clientWidth > 0])))
    .toEqual([['https://i.ytimg.com/vi/m-jjJKsWI24/mqdefault.jpg', true, true], ['https://i.ytimg.com/vi/7O6dZcTG2mQ/mqdefault.jpg', true, true]]);
  await page.locator('#video-service [data-train=front]').click();
  await page.locator('#mode-video .mode-confirm').click();
  await expect(page).toHaveURL(/\/video\/\?direction=front$/);
  await expect(page.locator('#stub-player')).toBeVisible();
  expect(await page.evaluate(() => stub.videoId)).toBe('m-jjJKsWI24');
  await page.locator('#journey-menu').click();
  await expect(page.locator('#video-service [data-train=front]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#video-service [data-train=back]').click();
  await page.locator('#mode-video .mode-confirm').click();
  await expect(page).toHaveURL(/\/video\/\?direction=back$/);
  await expect(page.locator('#journey-menu')).toHaveText('VIDEO');
  await expect(page.locator('#stub-player')).toBeVisible();
  await expect(page.locator('#custom-timeline')).toHaveCount(0);
  await expect(page.locator('.journey-views')).toBeHidden();
  expect(await page.evaluate(() => stub.videoId)).toBe('7O6dZcTG2mQ');

  // The picture changes only with the player's position: next cues, then the countdown dial.
  await expect.poll(() => picture(page)).toMatch(/^data:image\/png/);
  const start = await picture(page);
  await page.evaluate(() => { stub.time = 10; });
  await expect.poll(() => picture(page)).not.toBe(start);
  const upcoming = await picture(page);
  await page.waitForTimeout(300); expect(await picture(page)).toBe(upcoming);
  await page.evaluate(() => { stub.time = 25; });
  await expect.poll(() => picture(page)).not.toBe(upcoming);

  // The VIDEO label folds away while idle; the player changing state, the pointer
  // entering the player and the strip where the label was bring it back.
  const labelTop = () => page.locator('#journey-menu').evaluate(node => Math.round(node.getBoundingClientRect().bottom));
  await expect.poll(labelTop, { timeout: 8000 }).toBe(0);
  await page.evaluate(() => stub.change(1));
  await expect.poll(labelTop).toBeGreaterThan(50);
  await expect.poll(labelTop, { timeout: 8000 }).toBe(0);
  await page.mouse.move(720, 600); await page.mouse.move(700, 500);
  await expect.poll(labelTop, { timeout: 8000 }).toBe(0);
  await page.mouse.move(720, 30);
  await expect.poll(labelTop).toBeGreaterThan(50);
  await expect(page.locator('#mode-menu')).toBeHidden();
  await page.mouse.move(20, 1000);
  await expect.poll(labelTop, { timeout: 8000 }).toBe(0);
  await page.mouse.move(700, 500);
  await expect.poll(labelTop).toBeGreaterThan(50);
  await page.evaluate(() => { stub.state = 2; });

  // The menu pauses a playing video, resumes it on return, and leaving VIDEO removes the player.
  await page.evaluate(() => { stub.state = 1; });
  await page.locator('#journey-menu').click();
  await expect.poll(() => page.evaluate(() => stub.state)).toBe(2);
  await page.locator('.mode-close').click();
  await expect.poll(() => page.evaluate(() => stub.state)).toBe(1);
  await page.locator('#journey-menu').click();
  await page.getByRole('tab', { name: 'CUSTOM' }).click();
  await page.locator('#mode-custom .mode-confirm').click();
  await expect(page).toHaveURL(/\/custom\//);
  expect(await page.evaluate(() => stub.destroyed)).toBe(true);
  await expect(page.locator('#journey-video')).toBeHidden();
});
