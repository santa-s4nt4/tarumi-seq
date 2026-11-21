import { test, expect } from '@playwright/test';
const fixed = new Date('2026-11-21T10:34:00+09:00');

async function recordPanels(page) {
  await page.evaluate(() => {
    window.panelFrames = [];
    window.recordPanels = true;
    function frame() {
      if (!window.recordPanels) return;
      const slot = document.querySelector('#timeline-slot'), menu = document.querySelector('#mode-menu');
      window.panelFrames.push({ menu: menu.open, state: menu.dataset.state,
        height: slot.getBoundingClientRect().height, timeline: slot.dataset.state, returning: document.body.classList.contains('menu-returning'),
        drawingHeight: document.querySelector('.mapboxgl-canvas')?.height });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
async function panelFrames(page) { return page.evaluate(() => { window.recordPanels = false; return window.panelFrames; }); }

for (const width of [1440, 390]) test(`OK keeps the map mounted and sequences the menu and timeline at ${width}px`, async ({page}) => {
  const errors = [], dataRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/data\/.*\.json/.test(request.url())) dataRequests.push(request.url()); });
  await page.route('https://*.mapbox.com/**', route => route.abort());
  await page.clock.setFixedTime(fixed); await page.setViewportSize({width, height:1000}); await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  await page.evaluate(() => { window.originalMap = document.querySelector('#map'); window.originalLine = document.querySelector('#line-map svg'); });
  await page.getByRole('tab', {name:'CUSTOM'}).click();
  await page.locator('input[name=direction][value=back]').check();
  await page.locator('#custom-service [data-train="18"]').click();
  await recordPanels(page);
  await page.locator('#mode-custom .mode-confirm').click();
  await expect(page).toHaveURL(/custom\/\?train=18&day=holiday$/);
  await expect(page.locator('#timeline-slot')).toHaveAttribute('data-state', 'visible');
  let frames = await panelFrames(page);
  expect(frames.some(frame => frame.menu && frame.state === 'closing' && frame.height === 0)).toBe(true);
  expect(frames.some(frame => !frame.menu && frame.timeline === 'entering' && frame.height > 0 && frame.returning)).toBe(true);
  expect(frames.every(frame => frame.timeline !== 'entering' || !frame.menu)).toBe(true);
  // Repeated WebGL canvas resizing used to clear the map during the slide.
  expect(new Set(frames.filter(frame => frame.timeline === 'entering').map(frame => frame.drawingHeight)).size).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => window.originalMap === document.querySelector('#map') && window.originalLine === document.querySelector('#line-map svg'))).toBe(true);
  expect(dataRequests).toHaveLength(4);
  // Controls reappear before the longer camera move ends; an explicit play
  // action must not be overwritten by the automatic playback restoration.
  await page.locator('#custom-play').click();
  await expect(page.locator('body')).not.toHaveClass(/menu-returning/);
  await expect(page.locator('#custom-play')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#custom-play').click();
  const footerHeight = (await page.locator('#custom-timeline').boundingBox()).height;
  await recordPanels(page);
  await page.getByRole('button', {name:'メニューを開く'}).click();
  await expect(page.locator('#mode-menu')).toBeVisible();
  frames = await panelFrames(page);
  expect(frames.some(frame => !frame.menu && frame.timeline === 'leaving' && frame.height > 0 && frame.height < footerHeight)).toBe(true);
  expect(frames.filter(frame => frame.menu).every(frame => frame.height === 0)).toBe(true);
  await page.getByRole('button', {name:'メニューを閉じる'}).click();
  await expect(page.locator('#timeline-slot')).toHaveAttribute('data-state', 'visible');
  await expect(page.locator('body')).not.toHaveClass(/menu-returning/);
  await expect(page.locator('#custom-play')).toHaveAttribute('aria-pressed','false');
  expect(await page.locator('.range-in').evaluate(node => getComputedStyle(node, '::before').content)).toBe('none');
  await page.goBack(); await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#mode-menu')).toBeVisible();
  await expect(page.getByRole('button', {name:'メニューを閉じる'})).toBeHidden();
  await page.goForward(); await expect(page).toHaveURL(/custom\/\?train=18&day=holiday$/);
  await expect(page.locator('#timeline-slot')).toHaveAttribute('data-state', 'visible');
  await expect(page.locator('#journey-clock')).toHaveText('10:33:00');
  expect(dataRequests).toHaveLength(4); expect(errors).toEqual([]);
});

for (const fallback of [false, true]) test(`overview circles show the departure and timetable on hover (${fallback ? 'fallback' : 'terrain'})`, async ({page}) => {
  if (fallback) await page.route('https://*.mapbox.com/**', route => route.abort());
  await page.clock.setFixedTime(fixed); await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  if (!fallback) await expect(page.locator('#line-map')).toBeHidden();
  const marker = page.locator(`${fallback ? '#line-map .line-train' : '.overview-train'}[data-train="18"]`);
  await expect(marker).toBeVisible(); await page.waitForTimeout(1900);
  const size = await marker.boundingBox(); expect(size.width).toBeCloseTo(22,3); expect(size.height).toBeCloseTo(22,3);
  expect(await marker.evaluate(node => getComputedStyle(node).borderRadius)).toBe('50%');
  const tooltip = marker.getByRole('tooltip'); await expect(tooltip).toBeHidden();
  await marker.hover(); await expect(tooltip).toBeVisible(); await expect(tooltip).toHaveText('樽見発 10:33–11:36');
  await marker.click(); await expect(page.locator('#menu-trains [data-train="18"]')).toHaveAttribute('aria-selected','true');
  await expect(page).toHaveURL(/\/$/);
});

test('sliding the timeline in terrain does not abruptly change the zoom before the menu opens', async ({page}) => {
  let resource; page.on('request', request => { if (request.url().includes('/deps/mapbox-gl.js')) resource = request.url(); });
  await page.setViewportSize({width:390,height:640}); await page.goto('/custom/?train=18&day=holiday');
  await expect(page.locator('.current-marker')).toBeVisible();
  await page.locator('#custom-seek').evaluate(node => { node.value=235; node.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.evaluate(async resource => {
    const lib=(await import(resource)).default, set=lib.Map.prototype.setFreeCameraOptions;
    lib.Map.prototype.setFreeCameraOptions=function(options) { window.transitionMap=this; return set.call(this,options); };
  }, resource);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    window.slideZooms=[];
    function frame() {
      if (document.querySelector('#mode-menu').open) return;
      window.slideZooms.push(window.transitionMap.getZoom()); requestAnimationFrame(frame);
    }
    frame();
  });
  await page.getByRole('button',{name:'メニューを開く'}).click(); await expect(page.locator('#mode-menu')).toBeVisible();
  const zooms=await page.evaluate(()=>window.slideZooms);
  expect(zooms.length).toBeGreaterThan(5);
  expect(Math.max(...zooms.slice(1).map((zoom,index)=>Math.abs(zoom-zooms[index])))).toBeLessThan(.1);
});
