// ローカルファースト: 電波がなくても起動・入力できる
const { test, expect } = require('@playwright/test');
const { openApp, capture, storedItems } = require('./helpers');
const { createServer } = require('./server');

// 圏外を本当に再現するため、このファイルのテストは専用のサーバーからアプリを開き、途中でサーバーを止める。
// (Playwright の setOffline や通信の遮断は、Service Worker 自身の通信には効かないことがあるため)
let server;
let base;
test.beforeEach(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/utushiyo/`;
});
test.afterEach(() => { if (server.listening) { server.closeAllConnections(); server.close(); } });

async function goOffline(context) {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await context.setOffline(true);
}

async function waitForServiceWorker(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // 初回はページが Service Worker の管理下に入るまで待つ
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
}

test('一度開いたあとは、通信できなくても起動して入力・保存できる', async ({ page, context }) => {
  await openApp(page, base);
  await capture(page, 'オンラインで入力');
  await waitForServiceWorker(page);

  await goOffline(context);
  await page.reload();
  await expect(page.locator('.inbox-link .count')).toHaveText('1 件');
  await capture(page, '圏外で入力');
  await expect(page.locator('.inbox-link .count')).toHaveText('2 件');
  expect(await storedItems(page)).toHaveLength(2);
});

test('通信できなくても ?add= の投げ込みを受け取れる', async ({ page, context }) => {
  await openApp(page, base);
  await waitForServiceWorker(page);
  await goOffline(context);
  await page.goto(base + '?add=' + encodeURIComponent('圏外の音声メモ'));
  await expect(page.locator('.inbox-link .count')).toHaveText('1 件');
  expect((await storedItems(page))[0].text).toBe('圏外の音声メモ');
});

test('Service Worker はアプリ本体をすべてキャッシュする', async ({ page }) => {
  await openApp(page, base);
  await waitForServiceWorker(page);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys.find(k => k.startsWith('nagekomi-')));
    return (await cache.keys()).map(r => new URL(r.url).pathname);
  });
  for (const p of ['/utushiyo/', '/utushiyo/index.html', '/utushiyo/manifest.webmanifest', '/utushiyo/icons/icon-180.png']) {
    expect(cached).toContain(p);
  }
});
