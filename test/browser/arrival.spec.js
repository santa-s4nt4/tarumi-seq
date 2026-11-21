import { test, expect } from '@playwright/test';

test('development uses the local API and respects an explicitly selected endpoint', async ({ page }) => {
  const publicEndpoint = 'https://tarumi-api.santanaruse.workers.dev/api/position';
  const localEndpoint = 'http://localhost:8787/api/position';
  await page.route(publicEndpoint, route => route.fulfill({ status: 503, json: { error: 'test_public_unavailable' } }));
  async function settings() {
    await page.getByRole('button', { name: 'メニューを開く' }).click();
    await page.locator('#api-button').click();
  }
  const localResponse = () => page.waitForResponse(r => r.url().endsWith('/local-api/api/position'));
  const initial = localResponse();
  await page.goto('/console/');
  expect((await initial).status()).toBe(200);
  await settings();
  await expect(page.locator('#endpoint')).toHaveValue(localEndpoint);
  const requested = page.waitForRequest(publicEndpoint);
  await page.locator('#public-endpoint').click();
  await requested;
  await settings();
  await expect(page.locator('#endpoint')).toHaveValue(publicEndpoint);
  await page.locator('#reset-endpoint').click();
  const restored = localResponse();
  await page.locator('#settings-form button[type="submit"]').click();
  expect((await restored).status()).toBe(200);
});
