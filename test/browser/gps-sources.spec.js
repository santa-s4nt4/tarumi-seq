import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const recording = direction => JSON.parse(readFileSync('data/gps-' + direction + '.json'));
const localApi = '/local-api/api/';
test.beforeEach(async ({ page }) => {
  await page.route('https://*.mapbox.com/**', route => route.abort());
});

for (const [direction, train] of [['front', '23'], ['back', '28']]) {
  test('LIVE consumes the local ' + direction + ' GPS recording on its recorded clock', async ({ page }) => {
    const data = recording(direction);
    await page.clock.install({ time: new Date('2026-11-21T03:00:00+09:00') });
    await page.goto('/live/');
    await page.getByLabel('GPS記録の方向').selectOption(direction);
    const response = page.waitForResponse(r => r.url().endsWith(localApi + 'recordings/' + direction));
    await page.getByRole('button', { name: '記録GPSで試す' }).click();
    expect((await (await response).json()).records).toEqual(data.records);
    await expect(page.locator('#live-status')).toContainText(train + '列車');
    await expect(page.locator('#gps-source')).toContainText('2026-11-04');
    await expect(page.getByRole('img', { name: 'GPS測位位置' })).toBeVisible();
    const marker = page.locator('#line-map .gps-marker');
    await page.clock.fastForward(9000);
    await expect(page.locator('#gps-source')).toContainText('00:09');
    await expect(marker).toBeVisible();
    if (direction === 'front') await page.getByRole('button', { name: '記録を終了' }).click();
    else await page.clock.fastForward(data.records.at(-1).t * 1000);
    await expect(page.locator('#gps-source')).toContainText('現在時刻に戻りました');
    await expect(page.locator('#live-status')).toContainText('運行中の列車はありません');
    await expect(marker).toBeHidden();
  });
}

test('a separate phone sends fixes only after Start, and stopping revokes the link', async ({ page, browser, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/live/');
  await page.getByRole('button', { name: 'スマホのGPSを使う' }).click();
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
  await page.getByRole('button', { name: 'リンクをコピー' }).click();
  const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(link.protocol).toBe('https:');
  const phone = await browser.newContext({ isMobile: true, viewport: { width: 390, height: 844 },
    permissions: ['geolocation'], geolocation: { latitude: 35.487792, longitude: 136.669991, accuracy: 4 }, ignoreHTTPSErrors: true });
  try {
    const sender = await phone.newPage();
    // Normal CI uses a separate context on localhost. The LAN check follows the actual QR origin.
    await sender.goto(process.env.TARUMI_TEST_PHONE_LAN ? link.href : new URL(link.pathname + link.hash, baseURL).href);
    await expect(sender.getByRole('status')).toHaveText('送信待ち');
    await expect(page.locator('#gps-source')).toHaveText('スマホの送信待ち');
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await sender.getByRole('button', { name: 'GPSを送信する' }).click();
    await expect(sender.getByRole('status')).toContainText('PCに送信中');
    await expect(page.locator('#gps-source')).toHaveText('スマホGPS受信中');
    await expect(page.getByRole('img', { name: 'GPS測位位置' })).toBeVisible();
    await phone.setGeolocation({ latitude: 35.4901, longitude: 136.6681, accuracy: 6 });
    await expect(sender.getByRole('status')).toContainText('±6 m');
    await sender.getByRole('button', { name: '送信を終了' }).click();
    await expect(page.locator('#gps-source')).toContainText('終了');
    await expect(page.getByRole('img', { name: 'GPS測位位置' })).toBeHidden();
    await expect(page.getByRole('button', { name: '記録GPSで試す' })).toBeEnabled();
  } finally { await phone.close(); }
});

test('the local relay keeps only the newest fix and enforces the two link roles', async ({ request }) => {
  const create = await request.post(localApi + 'gps-links');
  expect(create.status()).toBe(201);
  const link = await create.json(), resource = localApi + 'gps-links/' + link.id;
  const auth = token => ({ Authorization: 'Bearer ' + token });
  const reader = auth(link.reader), writer = auth(link.writer);
  const fix = { timestamp: Date.now(), latitude: 35.49, longitude: 136.66, accuracy: 4 };
  try {
    expect((await request.get(resource, { headers: writer })).status()).toBe(404);
    expect((await request.put(resource, { headers: reader, data: fix })).status()).toBe(404);
    expect((await request.put(resource, { headers: writer, data: { ...fix, timestamp: fix.timestamp - 20000 } })).status()).toBe(400);
    expect((await request.put(resource, { headers: writer, data: fix })).ok()).toBe(true);
    expect((await request.put(resource, { headers: writer, data: { ...fix, latitude: 0, timestamp: fix.timestamp - 300 } })).ok()).toBe(true);
    const { position } = await (await request.get(resource, { headers: reader })).json();
    expect(position.coords.latitude).toBe(fix.latitude);
    expect(position.timestamp).toBe(fix.timestamp);
  } finally { await request.delete(resource, { headers: reader }); }
  expect((await request.head(resource, { headers: writer })).status()).toBe(404);
});

test('the section picker follows the recorded train and clock, then returns to current service', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T03:00:00+09:00') });
  await page.goto('/live/');
  await page.getByRole('button', { name: '記録GPSで試す' }).click();
  await expect(page.locator('#live-status')).toContainText('23列車');
  await page.getByRole('button', { name: 'ダイヤ・区間を選ぶ' }).click();
  await expect(page.locator('#simulation-departure')).toHaveValue('23');
  await expect(page.locator('#simulation-day')).toHaveValue('weekday');
  await page.locator('#simulation-station').selectOption('1');
  await page.locator('#simulation-end-station').selectOption('18');
  await expect(page.locator('#simulation-follow-status')).toContainText('2026-11-04');
  await page.getByRole('button', { name: '記録時刻で追従' }).click();
  await expect(page.locator('#live-status')).toContainText('23列車 · 大垣 → 水鳥 · 追従中');
  await page.getByRole('button', { name: '記録を終了' }).click();
  await expect(page.locator('#live-status')).toContainText('運行中の列車はありません');
  await page.getByRole('button', { name: 'ダイヤ・区間を選ぶ' }).click();
  await expect(page.locator('#simulation-day')).toHaveValue('holiday');
});
