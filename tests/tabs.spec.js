// 画面下のタブと、ズームの防止
const { test, expect } = require('@playwright/test');
const { openApp, capture } = require('./helpers');

test('起動すると投げ込みタブが開き、タブで1件表示・リストに切り替えられる', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#tabbar a.on')).toHaveText(/投げ込み/);
  await expect(page.locator('#capture-text')).toBeVisible();

  await page.locator('#tabbar a[data-tab=focus]').click();
  await expect(page.locator('#title')).toHaveText('1件表示');
  await expect(page.locator('.focus-card')).toBeVisible();
  await expect(page.locator('#capture-text')).toBeHidden();

  await page.locator('#tabbar a[data-tab=overview]').click();
  await expect(page.locator('#title')).toHaveText('リスト');
  await expect(page.locator('.tile', { hasText: 'インボックス' })).toBeVisible();
  await expect(page.locator('#tabbar a.on')).toHaveText(/リスト/);
});

test('投げ込みタブでインボックスの項目をその場で見て、押すと振り分けの編集画面が開く', async ({ page }) => {
  await openApp(page);
  await capture(page, '歯医者に電話');
  await expect(page.locator('#home-dynamic .rows .row-title')).toHaveText(['歯医者に電話']);
  await page.locator('#home-dynamic .row-body').click();
  await expect(page.locator('#edit-dialog')).toBeVisible();
  await page.locator('#edit-list').selectOption('today');
  await page.locator('#edit-form button[type=submit]').click();
  await expect(page.locator('#home-dynamic .rows')).toHaveCount(0);
  await page.locator('#tabbar a[data-tab=focus]').click();
  await expect(page.locator('.focus-title')).toHaveText('歯医者に電話');
});

test('左上の ☰ はどのタブからもメニューを開き、戻ると元のタブに帰る', async ({ page }) => {
  await openApp(page);
  await page.locator('#tabbar a[data-tab=overview]').click();
  await page.locator('#nav-btn').click();
  await expect(page.locator('#title')).toHaveText('メニュー');
  await expect(page.locator('#view-menu')).toContainText('リストの追加・編集');
  await page.locator('#nav-btn').click();
  await expect(page.locator('#title')).toHaveText('リスト');
});

test('起動時に投げ込み欄へ入力位置があっても、タブは表示されている', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#capture-text')).toBeFocused();
  await expect(page.locator('#tabbar')).toBeVisible();
});

test('ズームしない設定になっている', async ({ page }) => {
  await openApp(page);
  const vp = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(vp).toContain('maximum-scale=1');
  expect(vp).toContain('user-scalable=no');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe('manipulation');
  // iPhone の2本指の拡大(gesturestart)は打ち消される
  const prevented = await page.evaluate(() => {
    const ev = new Event('gesturestart', { cancelable: true, bubbles: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(true);
});
