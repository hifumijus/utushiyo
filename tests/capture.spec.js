// 投げ込み欄と ?add= による受け取り
const { test, expect } = require('@playwright/test');
const { openApp, capture, storedItems } = require('./helpers');

test('起動するとすぐ投げ込み欄に入力でき、トークン未設定なら「端末内のみ」と表示する', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#capture-text')).toBeFocused();
  await expect(page.locator('#sync-label')).toHaveText('端末内のみ');
  await expect(page.locator('.inbox-link .count')).toHaveText('空です');
});

test('投げ込んだ内容はインボックスに入り、端末内に要件どおりの形で保存される', async ({ page }) => {
  await openApp(page);
  await capture(page, '  牛乳を買う\n低脂肪のもの  ');
  await expect(page.locator('.inbox-link .count')).toHaveText('1 件');

  const [it] = await storedItems(page);
  expect(Object.keys(it).sort()).toEqual(
    ['created_at', 'deleted', 'due', 'id', 'list', 'note', 'status', 'tags', 'text', 'updated_at']);
  expect(it).toMatchObject({
    text: '牛乳を買う\n低脂肪のもの', note: '', list: 'inbox', tags: [], status: 'open', due: null, deleted: false,
  });
  expect(it.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(it.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  expect(it.updated_at).toBe(it.created_at);
});

test('空白だけの内容は追加できない', async ({ page }) => {
  await openApp(page);
  await page.locator('#capture-text').fill('   \n  ');
  await expect(page.locator('#capture-btn')).toBeDisabled();
  expect(await storedItems(page)).toHaveLength(0);
});

test('保存した内容は再起動後も残る', async ({ page }) => {
  await openApp(page);
  await capture(page, '再起動しても残る');
  await page.reload();
  await expect(page.locator('.inbox-link .count')).toHaveText('1 件');
});

test('?add= で渡したテキストをインボックスに保存し、URL から取り除く', async ({ page }) => {
  await openApp(page, '?add=' + encodeURIComponent('歯医者に電話する & 予約'));
  await expect(page.locator('.inbox-link .count')).toHaveText('1 件');
  await expect(page.locator('#toast-msg')).toContainText('インボックスに追加しました');
  expect(page.url()).not.toContain('add=');
  const [it] = await storedItems(page);
  expect(it.text).toBe('歯医者に電話する & 予約');
  expect(it.list).toBe('inbox');
});

test('?add= で開いたあと再読み込みしても二重に追加されない', async ({ page }) => {
  await openApp(page, '?add=' + encodeURIComponent('一度だけ'));
  await expect(page.locator('.inbox-link .count')).toHaveText('1 件');
  await page.reload();
  await expect(page.locator('.inbox-link .count')).toHaveText('1 件');
  expect(await storedItems(page)).toHaveLength(1);
});

test('?add= が空なら何も追加しない', async ({ page }) => {
  await openApp(page, '?add=');
  await expect(page.locator('.inbox-link .count')).toHaveText('空です');
  expect(await storedItems(page)).toHaveLength(0);
});
