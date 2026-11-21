import { test, expect } from '@playwright/test';
import fs from 'node:fs';
test.beforeEach(async({page})=>{await page.route('https://*.mapbox.com/**',r=>r.abort());});
for(const path of ['./','console/','console/index.html','performance/']) test(`production ${path} opens top modal and excludes development screens`,async({page})=>{
  await page.goto(path);await expect(page).toHaveURL(/\/tarumi-seq\/$/);
  await expect(page.locator('#mode-menu')).toBeVisible();await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('.console-readout-carousel,#performance-qr,#phone-link')).toHaveCount(0);
});
test('production CUSTOM and shared QUE links support subpath deployment',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-11-21T10:34:00+09:00'));
  await page.goto('que/?mode=playback&train=23&day=weekday&from=9&to=18');
  await expect(page).toHaveURL(/\/tarumi-seq\/custom\/\?train=23&day=weekday&from=9&to=18/);
  await expect(page.locator('#section-name')).toHaveText('本巣 → 水鳥');
  await page.getByRole('button',{name:'メニューを開く'}).click();await expect(page.locator('#mode-menu')).toBeVisible();
  await page.locator('input[value=holiday]').check();await page.locator('input[value=back]').check();
  await page.locator('#custom-service [data-train="18"]').click();await page.locator('#mode-custom .mode-confirm').click();
  await expect(page).toHaveURL(/\/tarumi-seq\/custom\/\?train=18&day=holiday$/);
  await expect(page.locator('#timeline-slot')).toHaveAttribute('data-state','visible');
  await page.goBack();await expect(page.locator('#section-name')).toHaveText('本巣 → 水鳥');
});
test('production artifacts contain no Console markup or QR relay implementation',()=>{
  expect(fs.existsSync('dist/performance')).toBe(false);
  const built=fs.readdirSync('dist/assets').filter(n=>n.endsWith('.js')).map(n=>fs.readFileSync('dist/assets/'+n,'utf8')).join('');
  expect(built).not.toContain('performance-qr');expect(built).not.toContain('gps-links');expect(built).not.toContain('request-json');
  expect(built).not.toContain('tarumi-api.santanaruse.workers.dev');
  expect(fs.readFileSync('dist/index.html','utf8')).not.toContain('request-json');
});
