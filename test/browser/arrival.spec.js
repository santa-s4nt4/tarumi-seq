import { test, expect } from '@playwright/test';

test('defaults to public and switches to local only when selected', async ({ page }) => {
 const requests=[];
 page.on('request',r=>{if(r.url().endsWith('/api/position')&&r.method()==='POST')requests.push(r.url());});
 const publicEndpoint='https://tarumi-api.santanaruse.workers.dev/api/position';
 const localEndpoint='http://localhost:8787/api/position';
 const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type'};
 await page.route(publicEndpoint,r=>r.request().method()==='OPTIONS'
  ?r.fulfill({status:204,headers:cors})
  :r.fulfill({status:503,headers:cors,json:{error:'test_public_unavailable'}}));
 await page.goto('/');
 await expect.poll(()=>requests[0]).toBe(publicEndpoint);
 await page.locator('#settings-button').click();
 await expect(page.locator('#endpoint')).toHaveValue(publicEndpoint);
 await page.locator('#reset-endpoint').click();
 await expect(page.locator('#endpoint')).toHaveValue(localEndpoint);
 await page.locator('#settings-form button[type="submit"]').click();
 await expect.poll(()=>requests.at(-1)).toBe(`${new URL(page.url()).origin}/local-api/api/position`);
 await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み',{timeout:15000});
 await expect(page.locator('#train-speed')).not.toHaveText('—');
 await page.locator('#settings-button').click();
 await page.locator('#public-endpoint').click();
 await expect.poll(()=>requests.at(-1)).toBe(publicEndpoint);
});
