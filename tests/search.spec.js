// 条件で探す(時間・タグ・ためておくリストを含めるか を組み合わせる)
const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers');

// [リスト, 本文, 見込み(分), タグ, 期限]
const PLAN = [
  ['chores', '風呂掃除', 60, '家', null],
  ['chores', 'ゴミ出し', 5, '家', '2026-10-15'],
  ['chores', 'エアコン掃除', 15, '家', null],
  ['todo', 'メルカリ出品', 30, 'PCの前', null],
  ['todo', '父に電話', 5, 'スマホだけ', null],
  ['todo', '見込みなしの用事', null, '家', null],
  ['shopping', '電池', 5, '家、100均', null],
  ['movies', 'ジョンウィック', 60, '家', null],
  ['work', '会社の用事', 5, '家', null],
];

async function setup(page) {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00+09:00') });
  await openApp(page);
  await page.evaluate(async plan => {
    for (const [list, text, est, tags, due] of plan) {
      await addItem(text, list, { estimate_min: est, due });
      const it = [...state.items.values()].find(i => i.text === text);
      await updateItem(it.id, { tags: parseTags(tags) });
    }
  }, PLAN);
  await page.goto('#/');
  await page.locator('[data-action=toggle-search]').click();
}
const titles = page => page.locator('#home-dynamic .rows').filter({ has: page.locator('.row-start') }).locator('.row-title');
const tagChip = (page, t) => page.locator(`[data-action=search-tag][data-tag="${t}"]`);
const minChip = (page, m) => page.locator(`[data-action=search-min][data-min="${m}"]`);

test('時間とタグを組み合わせて探せる(家で15分 → 家の15分以内のもの)', async ({ page }) => {
  await setup(page);
  await tagChip(page, '家').click();
  await minChip(page, '15').click();
  await expect(titles(page)).toHaveText(['ゴミ出し', 'エアコン掃除', '電池']); // 期限の近いもの → 時間を使い切れる順
  await expect(page.locator('#home-dynamic')).toContainText('当てはまる項目(3)');
  await expect(page.locator('.gap-hint')).toContainText('見込み時間が未登録の項目(1 件)');
  await expect(page.locator('.search-summary')).toHaveText('15分以内・家');
});

test('時間を指定しなければ、見込み時間の無い項目も出す', async ({ page }) => {
  await setup(page);
  await tagChip(page, '家').click();
  await expect(titles(page)).toContainText(['見込みなしの用事']);
  await expect(titles(page)).toHaveCount(5); // 風呂・ゴミ・エアコン・見込みなし・電池(映画と会社は除く)
});

test('タグを複数選ぶと、どれかが付いている項目を出す', async ({ page }) => {
  await setup(page);
  await tagChip(page, 'PCの前').click();
  await tagChip(page, 'スマホだけ').click();
  await expect(titles(page)).toHaveText(['父に電話', 'メルカリ出品']); // 時間指定なしは短い順
  await tagChip(page, 'PCの前').click(); // もう一度押すと外れる
  await expect(titles(page)).toHaveText(['父に電話']);
});

test('ためておくリストは切り替えで含められる。仕事へ転記は常に除く', async ({ page }) => {
  await setup(page);
  await minChip(page, '60').click();
  await tagChip(page, '家').click();
  await expect(page.locator('#home-dynamic')).not.toContainText('ジョンウィック');
  await page.locator('[data-action=search-stock]').check();
  await expect(titles(page)).toContainText(['ジョンウィック']);
  await expect(page.locator('#home-dynamic')).not.toContainText('会社の用事');
});

test('選んだ条件は再起動後も残り、結果から計測を始められる', async ({ page }) => {
  await setup(page);
  await tagChip(page, '家').click();
  await minChip(page, '5').click();
  await page.reload();
  await page.locator('[data-action=toggle-search]').click();
  await expect(tagChip(page, '家')).toHaveClass(/on/);
  await expect(minChip(page, '5')).toHaveClass(/on/);
  await expect(titles(page)).toHaveText(['ゴミ出し', '電池']);
  await page.locator('#home-dynamic .row', { hasText: '電池' }).locator('[data-action=start]').click();
  await expect(page.locator('.focus-title')).toHaveText('電池');
  await expect(page.locator('.focus-card [data-action=pause]')).toBeVisible();
});

test('当てはまる項目が多いときは10件まで出し、残りは押すと出る', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00+09:00') });
  await openApp(page);
  await page.evaluate(async () => { await addItems(Array.from({ length: 13 }, (_, i) => `用事${i + 1}`), 'todo'); });
  await page.goto('#/');
  await page.locator('[data-action=toggle-search]').click();
  await expect(titles(page)).toHaveCount(10);
  await page.locator('[data-action=search-all]').click();
  await expect(titles(page)).toHaveCount(13);
});

test.describe('この条件で1件ずつ片付ける', () => {
  async function filterOn(page) {
    await tagChip(page, '家').click();
    await minChip(page, '5').click();
    await page.locator('[data-action=focus-filter-on]').click();
  }
  const focusTitle = page => page.locator('.focus-title');

  test('1件表示が条件に当てはまる項目だけになり、完了すると次の当てはまる項目へ進む', async ({ page }) => {
    await setup(page);
    await filterOn(page);
    await expect(page.locator('.filter-bar')).toContainText('絞り込み中: 5分以内・家');
    await expect(page.locator('.focus-meta')).toContainText('残り 2 件');
    await expect(focusTitle(page)).toHaveText('ゴミ出し'); // 期限の近いものが先
    await page.locator('.focus-card [data-action=done]').click();
    await expect(focusTitle(page)).toHaveText('電池');
    await page.locator('.focus-card [data-action=done]').click();
    await expect(page.locator('.focus-card')).toContainText('条件に当てはまる項目は残っていません');
    await page.locator('.focus-card [data-action=focus-filter-off]').click();
    await expect(page.locator('.filter-bar')).toHaveCount(0);
    await expect(focusTitle(page)).not.toHaveText(''); // 通常の1件表示に戻る
  });

  test('後回しは条件の中で順番を後ろへ回すだけで、項目の updated_at は変えない', async ({ page }) => {
    await setup(page);
    await filterOn(page);
    const before = await page.evaluate(() => [...state.items.values()].find(i => i.text === 'ゴミ出し').updated_at);
    await page.locator('.focus-card [data-action=later]').click();
    await expect(focusTitle(page)).toHaveText('電池');
    await page.locator('.focus-card [data-action=later]').click();
    await expect(focusTitle(page)).toHaveText('ゴミ出し');
    const after = await page.evaluate(() => [...state.items.values()].find(i => i.text === 'ゴミ出し').updated_at);
    expect(after).toBe(before);
  });

  test('絞り込みは再起動後も続き、条件に当てはまらない項目は出てこない', async ({ page }) => {
    await setup(page);
    await filterOn(page);
    await page.reload();
    await expect(page.locator('.filter-bar')).toContainText('5分以内・家');
    const seen = [];
    for (let i = 0; i < 4; i++) {
      seen.push(await focusTitle(page).textContent());
      await page.locator('.focus-card [data-action=later]').click();
    }
    expect(new Set(seen)).toEqual(new Set(['ゴミ出し', '電池']));
    await page.locator('.filter-bar [data-action=focus-filter-off]').click();
    await expect(page.locator('#toast-msg')).toHaveText('絞り込みを解除しました');
  });
});
