// リストの追加・名前の変更・並べ替え・削除と、その同期
const { test, expect } = require('@playwright/test');
const { FakeGitHub, remoteItem, openApp, storedItems, configureSync, expectSyncState } = require('./helpers');

async function storedLists(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('nagekomi');
    req.onsuccess = () => {
      const g = req.result.transaction('meta', 'readonly').objectStore('meta').get('lists');
      g.onsuccess = () => { resolve(g.result || null); req.result.close(); };
      g.onerror = () => reject(g.error);
    };
  }));
}
async function addList(page, name, kind = 'action') {
  await page.goto('#/lists');
  await page.locator('#list-add-name').fill(name);
  await page.locator('#list-add-kind').selectOption(kind);
  await page.locator('#list-add-form button[type=submit]').click();
}
const row = (page, name) => page.locator('.list-row', { has: page.locator('.nm', { hasText: name }) });
async function addItemTo(page, listId, text) {
  await page.goto('#/list/' + encodeURIComponent(listId));
  await page.locator('#list-capture-text').fill(text);
  await page.locator('#list-capture-btn').click();
  await expect(page.locator('#list-capture-text')).toHaveValue('');
}

test('リストを追加すると、メニュー・ホームの件数・編集画面の選択肢に出て、項目を入れられる', async ({ page }) => {
  await openApp(page);
  await addList(page, '行きたい場所');
  await expect(page.locator('#toast-msg')).toHaveText('「行きたい場所」を追加しました');
  await expect(page.locator('#list-add-name')).toHaveValue('');
  const l = (await storedLists(page)).find(x => x.name === '行きたい場所');
  expect(l).toMatchObject({ stock: false, deleted: false });
  expect(l.id).toMatch(/^l-[0-9a-f]{8}$/);

  await page.goto('#/menu');
  await page.locator('#view-menu a', { hasText: '行きたい場所' }).click();
  await expect(page.locator('#title')).toHaveText('行きたい場所');
  await page.locator('#list-capture-text').fill('温泉');
  await page.locator('#list-capture-btn').click();
  expect((await storedItems(page))[0].list).toBe(l.id);

  await page.goto('#/overview');
  await expect(page.locator('.tile', { hasText: '行きたい場所' }).locator('.num')).toHaveText('1');
  await page.locator('.tile', { hasText: '行きたい場所' }).click();
  await page.locator('#list-dynamic .row-body').first().click();
  await expect(page.locator('#edit-list option', { hasText: '行きたい場所' })).toHaveCount(1);
});

test('ためておくリストとして追加すると、メニューのためておく欄に入り、ホームには個別に出さない', async ({ page }) => {
  await openApp(page);
  await addList(page, '聴きたい音楽', 'stock');
  await page.goto('#/menu');
  const stockSection = page.locator('#view-menu .menu-list').nth(1);
  await expect(stockSection).toContainText('聴きたい音楽');
  await page.goto('#/overview');
  await expect(page.locator('.tile', { hasText: '聴きたい音楽' })).toHaveCount(0);
});

test('名前が空・重複・長すぎるときは追加しない', async ({ page }) => {
  await openApp(page);
  const before = (await storedLists(page)) || [];
  await addList(page, '  ');
  await expect(page.locator('#toast-msg')).toHaveText('名前を入力してください');
  await addList(page, '家事');
  await expect(page.locator('#toast-msg')).toHaveText('「家事」はすでにあります');
  await page.locator('#list-add-name').evaluate(el => el.removeAttribute('maxlength'));
  await page.locator('#list-add-name').fill('あ'.repeat(21));
  await page.locator('#list-add-form button[type=submit]').click();
  await expect(page.locator('#toast-msg')).toHaveText('名前は20文字までです');
  expect(((await storedLists(page)) || []).length).toBe(before.length);
});

test('最初からあるリストの名前を変えても、項目の list の値はそのまま', async ({ page }) => {
  await openApp(page);
  await addItemTo(page, 'today', '請求書');
  await page.goto('#/lists');
  await row(page, '今日やる').locator('[data-action=list-edit]').click();
  await page.locator('#list-name').fill('本日');
  await page.locator('#list-form button[type=submit]').click();
  await page.goto('#/focus');
  await expect(page.locator('.focus-meta')).toContainText('本日');
  await expect(page.locator('#focus-dynamic .section-title', { hasText: '本日(1)' })).toHaveCount(1); // 見出しも新しい名前
  expect((await storedItems(page))[0].list).toBe('today');
  expect((await storedLists(page)).find(l => l.id === 'today').name).toBe('本日');
});

test('インボックス・今日やる・やることは削除も種類の変更もできない', async ({ page }) => {
  await openApp(page);
  await page.goto('#/lists');
  for (const name of ['インボックス', '今日やる', 'やること']) {
    await row(page, name).locator('[data-action=list-edit]').click();
    await expect(page.locator('#list-delete')).toBeHidden();
    await expect(page.locator('#list-kind')).toBeDisabled();
    await page.locator('#list-cancel').click();
  }
  await row(page, '家事').locator('[data-action=list-edit]').click();
  await expect(page.locator('#list-delete')).toBeVisible();
  await expect(page.locator('#list-kind')).toBeEnabled();
});

test('リストを削除すると、中の項目(完了済みも)はインボックスに戻る。キャンセルすれば何も変わらない', async ({ page }) => {
  await openApp(page);
  await addItemTo(page, 'chores', '掃除');
  await addItemTo(page, 'chores', '洗濯');
  await page.locator('.row', { hasText: '洗濯' }).locator('.check').click();

  await page.goto('#/lists');
  await row(page, '家事').locator('[data-action=list-edit]').click();
  page.once('dialog', d => d.dismiss());
  await page.locator('#list-delete').click();
  expect((await storedItems(page)).every(i => i.list === 'chores')).toBe(true);

  let message = '';
  page.once('dialog', d => { message = d.message(); d.accept(); });
  await page.locator('#list-delete').click();
  await expect(page.locator('#toast-msg')).toHaveText('「家事」を削除しました(1 件をインボックスへ)');
  expect(message).toContain('未完了 1 件');
  const items = await storedItems(page);
  expect(items.map(i => i.list)).toEqual(['inbox', 'inbox']);
  expect(items.find(i => i.text === '洗濯').status).toBe('done');
  await expect(row(page, '家事')).toHaveCount(0);
  expect((await storedLists(page)).find(l => l.id === 'chores').deleted).toBe(true);
  await page.goto('#/menu');
  await expect(page.locator('#view-menu')).not.toContainText('家事');
});

test('↑↓で並べ替えると、メニューの順番が変わり、再起動後も保たれる', async ({ page }) => {
  await openApp(page);
  await page.goto('#/lists');
  await row(page, '家事').locator('[data-action=list-up]').click();
  await expect(page.locator('#lists-dynamic .menu-list').first().locator('.nm')).toContainText(['インボックス', '今日やる', 'やること', '家事', '仕事へ転記']);
  await page.reload();
  await page.goto('#/menu');
  const names = await page.locator('#view-menu .menu-list').first().locator('a > span:first-child').allTextContents();
  expect(names.slice(0, 5)).toEqual(['インボックス', '今日やる', 'やること', '家事', '仕事へ転記']);
  // 先頭の↑・末尾の↓は押せない
  await page.goto('#/lists');
  await expect(row(page, 'インボックス').locator('[data-action=list-up]')).toBeDisabled();
});

test.describe('同期', () => {
  let gh;
  test.beforeEach(async ({ context }) => {
    gh = new FakeGitHub();
    gh.setDoc({ schema_version: 1, items: [] });
    await gh.install(context);
  });

  test('GitHub にリストの定義が無く、リストを変えていなければ、書き込まない', async ({ page }) => {
    await openApp(page);
    await configureSync(page);
    await expectSyncState(page, 'synced');
    expect(gh.requests.filter(r => r.method === 'PUT')).toHaveLength(0);
  });

  test('追加・削除したリストは GitHub の lists に書き込まれる', async ({ page }) => {
    await openApp(page);
    await configureSync(page);
    await expectSyncState(page, 'synced');
    await addList(page, '行きたい場所');
    await expect.poll(() => (gh.doc().lists || []).some(l => l.name === '行きたい場所'), { timeout: 10_000 }).toBe(true);
    const doc = gh.doc();
    expect(doc.lists.map(l => l.id)).toEqual(expect.arrayContaining(['inbox', 'today', 'todo', 'books']));
    await page.goto('#/lists');
    await row(page, '読みたい本').locator('[data-action=list-edit]').click();
    page.once('dialog', d => d.accept());
    await page.locator('#list-delete').click();
    await expect.poll(() => gh.doc().lists.find(l => l.id === 'books').deleted, { timeout: 10_000 }).toBe(true);
  });

  test('ほかの端末で追加・名前変更されたリストを取り込む', async ({ page }) => {
    const later = '2099-01-01T09:00:00+09:00';
    gh.setDoc({
      schema_version: 1,
      lists: [
        { id: 'inbox', name: 'インボックス', stock: false, order: 0, updated_at: '2026-10-15T00:00:00+09:00', deleted: false },
        { id: 'today', name: '本日', stock: false, order: 1, updated_at: later, deleted: false },
        { id: 'l-abcdef12', name: '別端末のリスト', stock: false, order: 20, updated_at: later, deleted: false },
      ],
      items: [remoteItem({ id: 'x', text: '別端末の項目', list: 'l-abcdef12' })],
    });
    await openApp(page);
    await configureSync(page);
    await expectSyncState(page, 'synced');
    await page.goto('#/menu');
    await expect(page.locator('#view-menu')).toContainText('別端末のリスト');
    await expect(page.locator('#view-menu')).toContainText('本日');
    await expect(page.locator('#view-menu')).not.toContainText('その他のリスト');
  });
});
