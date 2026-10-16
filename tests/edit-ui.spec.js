// 編集画面の使い勝手: 入力欄は1行から広がる、既存のタグを候補から選べる
const { test, expect } = require('@playwright/test');
const { FakeGitHub, remoteItem, openApp, storedItems, configureSync, expectSyncState } = require('./helpers');

// GitHub 側にタグ付きの項目を用意して同期で取り込む(画面から1件ずつ作るより速い)
async function seed(page, context, items) {
  const gh = new FakeGitHub();
  await gh.install(context);
  gh.setDoc({ schema_version: 1, items });
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  return gh;
}
async function openEdit(page, text) {
  await page.goto('#/list/inbox');
  await page.locator('#list-dynamic .row', { hasText: text }).locator('.row-body').click();
  await expect(page.locator('#edit-dialog')).toBeVisible();
}
const height = loc => loc.evaluate(el => el.getBoundingClientRect().height);
const picker = page => page.locator('#edit-tag-picker');

test('本文・メモは1行の高さで始まり、行を増やすと広がり、減らすと縮む', async ({ page, context }) => {
  await seed(page, context, [remoteItem({ id: 'a', text: '短い' })]);
  await openEdit(page, '短い');
  const text = page.locator('#edit-text'), note = page.locator('#edit-note');
  const one = await height(note);
  expect(one).toBeLessThan(60);
  expect(Math.abs(await height(text) - one)).toBeLessThan(2);

  await note.fill('1行目\n2行目\n3行目');
  const three = await height(note);
  expect(three).toBeGreaterThan(one + 30);
  await note.fill('1行目');
  expect(await height(note)).toBeLessThan(three - 30);
});

test('長い本文の項目を開くと、最初から中身に合わせた高さで出る(画面の4割まで)', async ({ page, context }) => {
  const long = Array.from({ length: 4 }, (_, i) => `行${i + 1}`).join('\n');
  const huge = Array.from({ length: 60 }, (_, i) => `行${i + 1}`).join('\n');
  await seed(page, context, [remoteItem({ id: 'a', text: long, note: huge })]);
  await openEdit(page, '行1');
  expect(await height(page.locator('#edit-text'))).toBeGreaterThan(90);
  const vh = page.viewportSize().height;
  expect(await height(page.locator('#edit-note'))).toBeLessThanOrEqual(vh * 0.4 + 1);
});

test('投げ込み欄も1行で始まり、改行すると広がる', async ({ page }) => {
  await openApp(page);
  const ta = page.locator('#capture-text');
  const one = await height(ta);
  expect(one).toBeLessThan(45);
  await ta.fill('a\nb\nc');
  expect(await height(ta)).toBeGreaterThan(one + 30);
});

test('タグの候補は、よく使うものから8件だけ出し、残りは「ほか n 件」で開く', async ({ page, context }) => {
  const items = [remoteItem({ id: 'target', text: '対象' })];
  // タグ t10 を10件、t09 を9件 … t01 を1件に付ける(名前の順と使う回数の順を逆にしておく)
  for (let k = 1; k <= 10; k++) {
    for (let n = 0; n <= 10 - k; n++) items.push(remoteItem({ id: `x${k}-${n}`, text: `他${k}-${n}`, list: 'todo', tags: ['t' + String(11 - k).padStart(2, '0')] }));
  }
  await seed(page, context, items);
  await openEdit(page, '対象');
  const chips = picker(page).locator('[data-tag]');
  await expect(chips).toHaveCount(8);
  await expect(chips.first()).toHaveText('t10 10');
  await expect(chips.nth(7)).toHaveText('t03 3');
  await picker(page).getByRole('button', { name: 'ほか 2 件 ▾' }).click();
  await expect(chips).toHaveCount(10);
  await picker(page).getByRole('button', { name: '少なく表示 ▴' }).click();
  await expect(chips).toHaveCount(8);
});

test('候補を押すとタグが付き、もう一度押すと外れる。保存すると tags に入る', async ({ page, context }) => {
  await seed(page, context, [
    remoteItem({ id: 'target', text: '対象', tags: ['急ぎ'] }),
    remoteItem({ id: 'b', text: '他1', list: 'todo', tags: ['家', '急ぎ'] }),
    remoteItem({ id: 'c', text: '他2', list: 'todo', tags: ['家'] }),
  ]);
  await openEdit(page, '対象');
  const tags = page.locator('#edit-tags');
  await expect(picker(page).locator('[data-tag].on')).toHaveText(['✓ 急ぎ 2']);
  await picker(page).locator('[data-tag="家"]').click();
  await expect(tags).toHaveValue('急ぎ、家、');
  await expect(picker(page).locator('[data-tag].on')).toHaveCount(2);
  await picker(page).locator('[data-tag="急ぎ"]').click();
  await expect(tags).toHaveValue('家、');
  await page.locator('#edit-form button[type=submit]').click();
  await expect(page.locator('#edit-dialog')).toBeHidden();
  const it = (await storedItems(page)).find(i => i.id === 'target');
  expect(it.tags).toEqual(['家']);
});

test('打ち始めると候補を絞り込み(ひらがな・カタカナの違いは無視)、押すと打ちかけの語を置き換える', async ({ page, context }) => {
  await seed(page, context, [
    remoteItem({ id: 'target', text: '対象' }),
    remoteItem({ id: 'b', text: '他1', list: 'todo', tags: ['パソコン', 'スマホだけ', '電話'] }),
  ]);
  await openEdit(page, '対象');
  const tags = page.locator('#edit-tags');
  await tags.fill('ぱそ');
  await expect(picker(page).locator('[data-tag]')).toHaveText(['パソコン 1']);
  await expect(picker(page)).toContainText('「ぱそ」は新しいタグになります');
  await picker(page).locator('[data-tag="パソコン"]').click();
  await expect(tags).toHaveValue('パソコン、');
  await tags.pressSequentially('電');
  await expect(picker(page).locator('[data-tag]:not(.on)')).toHaveText(['電話 1']);
  await tags.fill('パソコン、電報');
  await expect(picker(page).locator('[data-tag]:not(.on)')).toHaveCount(0);
  await expect(picker(page)).toContainText('「電報」は新しいタグになります');
});

test('タグの書き方だけが変わった(末尾の読点など)ときは、変更として扱わない', async ({ page, context }) => {
  await seed(page, context, [remoteItem({ id: 'target', text: '対象', tags: ['家'] })]);
  await openEdit(page, '対象');
  await page.locator('#edit-tags').fill(' 家 ');
  const before = (await storedItems(page)).find(i => i.id === 'target').updated_at;
  await page.locator('#edit-form button[type=submit]').click();
  await expect(page.locator('#edit-dialog')).toBeHidden();
  expect((await storedItems(page)).find(i => i.id === 'target').updated_at).toBe(before);
});
