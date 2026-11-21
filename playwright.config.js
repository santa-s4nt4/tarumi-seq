import { defineConfig } from '@playwright/test';
const production = process.env.TARUMI_TEST_PRODUCTION === '1';
const baseURL = production ? 'http://127.0.0.1:4173/tarumi-seq/' : 'http://127.0.0.1:5173';
export default defineConfig({
  testDir: './test/browser',
  testMatch: production ? '**/production.spec.js' : '**/*.spec.js',
  testIgnore: production ? [] : ['**/production.spec.js'],
  timeout: 45000,
  use: { baseURL, channel: 'chrome', headless: true, viewport: { width: 1440, height: 1024 }, launchOptions: { args: ['--enable-webgl', '--ignore-gpu-blocklist'] } },
  webServer: { command: production ? 'npm run preview -- --base=/tarumi-seq/' : 'npm run dev', url: baseURL, reuseExistingServer: !production },
});
