import { test, expect } from '@playwright/test';

test('defaults to local, holds station at arrival, shows speed, switches public on click', async ({ page }) => {
 const requests=[];
 page.on('request',r=>{if(r.url().endsWith('/api/position')&&r.method()==='POST')requests.push(r.url());});
 await page.addInitScript(()=>localStorage.setItem('tarumi-api-endpoint','https://old.example/api/position'));
 await page.goto('/');
 await expect(page.locator('#api-badge-text')).toHaveText('API 接続済み',{timeout:15000});
 expect(requests[0]).toBe('http://localhost:8787/api/position');
 await expect(page.locator('#train-speed')).not.toHaveText('—');
 for(const t of [480,510]) {
  await page.locator('#seek').evaluate((el,t)=>{el.value=t;el.dispatchEvent(new Event('input',{bubbles:true}));},t);
  await expect(page.locator('#station-name')).toHaveText('木知原');
  await expect(page.locator('#station-eta')).toHaveText('0');
 }
 await page.route('https://tarumi-api.santanaruse.workers.dev/api/position',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"test public selected"}'}));
 await page.locator('#settings-button').click();
 await page.locator('#public-endpoint').click();
 await expect.poll(()=>requests.at(-1)).toBe('https://tarumi-api.santanaruse.workers.dev/api/position');
});
