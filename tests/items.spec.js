// リスト別の一覧、項目の編集・完了・削除
const { test, expect } = require('@playwright/test');
const { openApp, capture, storedItems } = require('./helpers');

async function editFirstRow(page, scope = '#list-dynamic') {
  await page.locator(`${scope} .row .row-body`).first().click();
  await expect(page.locator('#edit-dialog')).toBeVisible();
}

test('編集でリスト・期限・タグ・メモを変えると、updated_at が新しくなり変えた欄だけが変わる', async ({ page }) => {
  await openApp(page);
  await capture(page, '歯医者に電話する');
  const [before] = await storedItems(page);

  await page.locator('.inbox-link').click();
  await editFirstRow(page);
  await page.locator('#edit-list').selectOption('today');
  await page.locator('#edit-due').fill('2026-10-20');
  await page.locator('#edit-tags').fill('電話、急ぎ, 平日');
  await page.locator('#edit-note').fill('午前中に');
  await page.locator('#edit-form button[type=submit]').click();

  await expect(page.locator('#list-dynamic .row')).toHaveCount(0); // インボックスから消える
  const [after] = await storedItems(page);
  expect(after).toMatchObject({
    id: before.id, text: '歯医者に電話する', list: 'today', due: '2026-10-20',
    tags: ['電話', '急ぎ', '平日'], note: '午前中に', created_at: before.created_at,
  });
  expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.updated_at));
});

test('何も変えずに保存したときは updated_at を変えない', async ({ page }) => {
  await openApp(page);
  await capture(page, 'そのまま');
  const [before] = await storedItems(page);
  await page.locator('.inbox-link').click();
  await editFirstRow(page);
  await page.locator('#edit-form button[type=submit]').click();
  await expect(page.locator('#edit-dialog')).toBeHidden();
  const [after] = await storedItems(page);
  expect(after.updated_at).toBe(before.updated_at);
});

test('本文を空にして保存しようとすると止める', async ({ page }) => {
  await openApp(page);
  await capture(page, '消さないで');
  await page.locator('.inbox-link').click();
  await editFirstRow(page);
  await page.locator('#edit-text').fill('  ');
  await page.locator('#edit-form button[type=submit]').click();
  await expect(page.locator('#toast-msg')).toHaveText('本文を入力してください');
  const [it] = await storedItems(page);
  expect(it.text).toBe('消さないで');
});

test('一覧の丸を押すと完了になり、「元に戻す」で未完了に戻る', async ({ page }) => {
  await openApp(page);
  await capture(page, '洗濯');
  await page.locator('.inbox-link').click();
  await page.locator('#list-dynamic .row .check').first().click();
  await expect(page.locator('#list-dynamic .row')).toHaveCount(0);
  expect((await storedItems(page))[0].status).toBe('done');

  await page.locator('#toast-action').click();
  await expect(page.locator('#list-dynamic .row')).toHaveCount(1);
  expect((await storedItems(page))[0].status).toBe('open');
});

test('削除は確認のうえ deleted: true にするだけで、物理的には消さない', async ({ page }) => {
  await openApp(page);
  await capture(page, '要らない項目');
  await page.locator('.inbox-link').click();
  await editFirstRow(page);
  page.once('dialog', d => d.accept());
  await page.locator('#edit-delete').click();
  await expect(page.locator('#list-dynamic .row')).toHaveCount(0);
  const items = await storedItems(page);
  expect(items).toHaveLength(1);
  expect(items[0].deleted).toBe(true);
  await page.goto('#/done');
  await expect(page.locator('#view-done .row')).toHaveCount(0); // 完了済みにも出さない
});

test('削除の確認で「キャンセル」を選ぶと何も変わらない', async ({ page }) => {
  await openApp(page);
  await capture(page, '残す項目');
  await page.locator('.inbox-link').click();
  await editFirstRow(page);
  page.once('dialog', d => d.dismiss());
  await page.locator('#edit-delete').click();
  expect((await storedItems(page))[0].deleted).toBe(false);
});

test('リスト画面からはそのリストに直接追加できる', async ({ page }) => {
  await openApp(page, '#/list/books');
  await expect(page.locator('#title')).toHaveText('読みたい本');
  await page.locator('#list-capture-text').fill('銀河鉄道の夜');
  await page.locator('#list-capture-btn').click();
  await expect(page.locator('#list-dynamic .row')).toHaveCount(1);
  expect((await storedItems(page))[0].list).toBe('books');
});

test('ホームには「ためておくリスト」を出さず、メニューから開ける', async ({ page }) => {
  await openApp(page, '#/list/movies');
  await page.locator('#list-capture-text').fill('見たい映画A');
  await page.locator('#list-capture-btn').click();
  await expect(page.locator('#list-dynamic .row')).toHaveCount(1);

  await page.goto('#/');
  await expect(page.locator('#home-dynamic')).not.toContainText('見たい映画A');
  await expect(page.locator('#home-dynamic')).not.toContainText('見たい映画');

  await page.locator('#nav-btn').click();
  await expect(page.locator('#view-menu')).toContainText('ためておくリスト');
  await page.locator('#view-menu a[href="#/list/movies"]').click();
  await expect(page.locator('#list-dynamic')).toContainText('見たい映画A');
});

test('完了済みの画面に完了した項目が出て、そこから未完了に戻せる', async ({ page }) => {
  await openApp(page);
  await capture(page, '終わったこと');
  await page.locator('.inbox-link').click();
  await page.locator('#list-dynamic .row .check').first().click();
  await page.goto('#/done');
  await expect(page.locator('#view-done .row')).toHaveCount(1);
  await page.locator('#view-done .row .check').click();
  await expect(page.locator('#view-done .row')).toHaveCount(0);
  expect((await storedItems(page))[0].status).toBe('open');
});

test('ホーム下部にリストごとの件数・期限切れの数・今日の完了数が出て、押すとそのリストへ移る', async ({ page }) => {
  await openApp(page);
  for (const [list, text] of [['chores', '掃除A'], ['chores', '掃除B'], ['books', '本A'], ['todo', '用事A']]) {
    await page.goto('#/list/' + list);
    await page.locator('#list-capture-text').fill(text);
    await page.locator('#list-capture-btn').click();
    await expect(page.locator('#list-capture-text')).toHaveValue('');
  }
  await page.goto('#/list/chores');
  await page.locator('.row', { hasText: '掃除A' }).locator('.row-body').click();
  await page.locator('#edit-due').fill('2000-01-01');
  await page.locator('#edit-form button[type=submit]').click();
  await page.goto('#/list/todo');
  await page.locator('.row', { hasText: '用事A' }).locator('.check').click();

  await page.goto('#/');
  const tile = name => page.locator('.tile', { has: page.locator('.name', { hasText: name }) });
  await expect(tile('家事').locator('.num')).toHaveText('2期限切れ1');
  await expect(tile('ためておく').locator('.num')).toHaveText('1');
  await expect(tile('やること').locator('.num')).toHaveText('0');
  await expect(tile('今日の完了').locator('.num')).toHaveText('1');
  await tile('家事').click();
  await expect(page.locator('#title')).toHaveText('家事');
});
