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

test.describe('1行ずつ別の項目にする', () => {
  async function turnOn(page) {
    await page.locator('#capture-form .split-check').check();
  }

  test('オンにすると各行が1件ずつ、貼り付けた順でインボックスに入る', async ({ page }) => {
    await openApp(page);
    await turnOn(page);
    await page.locator('#capture-text').fill('牛乳を買う\n\n  歯医者に電話  \n請求書を払う\n');
    await expect(page.locator('#capture-btn')).toHaveText('3件追加');
    await page.locator('#capture-btn').click();
    await expect(page.locator('.inbox-link .count')).toHaveText('3 件');
    await expect(page.locator('#toast-msg')).toHaveText('インボックスに 3 件を追加しました');

    const items = (await storedItems(page)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    expect(items.map(i => i.text)).toEqual(['牛乳を買う', '歯医者に電話', '請求書を払う']);
    expect(new Set(items.map(i => i.id)).size).toBe(3);
    expect(new Set(items.map(i => i.created_at)).size).toBe(3); // 順番が保てるよう時刻をずらす
    for (const it of items) expect(it).toMatchObject({ list: 'inbox', status: 'open', deleted: false, updated_at: it.created_at });
  });

  test('行頭の箇条書きの印は取り除き、数字の内容は削らない', async ({ page }) => {
    await openApp(page);
    await turnOn(page);
    await page.locator('#capture-text').fill('・洗剤\n- 電池\n* 封筒\n1. 切手\n2)ノート\n□ 傘\n3.5kgの米\n10.15 歯医者');
    await page.locator('#capture-btn').click();
    await expect(page.locator('.inbox-link .count')).toHaveText('8 件');
    const texts = (await storedItems(page)).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(i => i.text);
    expect(texts).toEqual(['洗剤', '電池', '封筒', '切手', 'ノート', '傘', '3.5kgの米', '10.15 歯医者']);
  });

  test('オフのままなら、複数行は1件として保存する(従来どおり)', async ({ page }) => {
    await openApp(page);
    await page.locator('#capture-text').fill('見出し\n詳細の行');
    await expect(page.locator('#capture-btn')).toHaveText('追加');
    await page.locator('#capture-btn').click();
    await expect(page.locator('.inbox-link .count')).toHaveText('1 件');
    expect((await storedItems(page))[0].text).toBe('見出し\n詳細の行');
  });

  test('リスト画面でも使え、オン・オフの選択は再起動後も残る', async ({ page }) => {
    await openApp(page);
    await turnOn(page);
    await page.reload();
    await page.goto('#/list/books');
    await expect(page.locator('#list-capture-form .split-check')).toBeChecked();
    await page.locator('#list-capture-text').fill('本A\n本B');
    await page.locator('#list-capture-btn').click();
    await expect(page.locator('#list-dynamic .row')).toHaveCount(2);
    expect((await storedItems(page)).every(i => i.list === 'books')).toBe(true);
  });
});
