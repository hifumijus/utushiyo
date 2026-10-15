// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8123;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // 不安定なテストを再実行でごまかさない
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium', // iPhone の画面サイズ・タッチ操作を Chromium で再現する
    baseURL: `http://localhost:${PORT}/utushiyo/`, // GitHub Pages と同じくサブフォルダで配信
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node tests/server.js ${PORT}`,
    url: `http://localhost:${PORT}/utushiyo/`,
    reuseExistingServer: !process.env.CI,
  },
});
