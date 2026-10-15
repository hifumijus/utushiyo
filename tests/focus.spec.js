// 1件表示モード(今日やる → やること の順に1件ずつ。完了・後回し)
const { test, expect } = require('@playwright/test');
const { FakeGitHub, remoteItem, openApp, storedItems, configureSync, expectSyncState } = require('./helpers');

// 画面操作で項目を作る(リスト画面から直接追加)
async function addTo(page, list, text) {
  await page.goto('#/list/' + list);
  await page.locator('#list-capture-text').fill(text);
  await page.locator('#list-capture-btn').click();
  await expect(page.locator('#list-capture-text')).toHaveValue('');
}

test('今日やる・やることが空なら、その旨を表示する', async ({ page }) => {
  await openApp(page);
  await page.goto('#/focus');
  await expect(page.locator('.focus-card')).toContainText('「今日やる」「やること」は空です');
  await expect(page.locator('.focus-card [data-action]')).toHaveCount(0);
});

test('今日やるを先に、古い順に1件ずつ表示し、今日やるが尽きたら、やることを表示する', async ({ page }) => {
  await openApp(page);
  await addTo(page, 'todo', 'やることA');
  await addTo(page, 'today', '今日1');
  await addTo(page, 'today', '今日2');
  await addTo(page, 'books', '本は出さない');
  await page.goto('#/focus');

  const title = page.locator('.focus-title');
  await expect(page.locator('.focus-meta')).toContainText('残り 3 件');
  const first = await title.textContent();
  expect(['今日1', '今日2']).toContain(first); // 同じ秒に作ると順は同着になりうる
  const second = first === '今日1' ? '今日2' : '今日1';

  await page.locator('.focus-card [data-action=done]').click();
  await expect(title).toHaveText(second);
  await page.locator('.focus-card [data-action=done]').click();
  await expect(title).toHaveText('やることA');
  await expect(page.locator('.focus-meta')).toContainText('やること');
  await expect(page.locator('.focus-card [data-action=later]')).toBeDisabled(); // 1件だけなら後回しできない
});

test('後回しは順番の最後へ回す。素早く続けて押しても毎回入れ替わる', async ({ page }) => {
  await openApp(page);
  await addTo(page, 'today', 'A');
  await addTo(page, 'today', 'B');
  await addTo(page, 'today', 'C');
  await page.goto('#/focus');
  const title = page.locator('.focus-title');

  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(await title.textContent());
    const prev = seen[seen.length - 1];
    await page.locator('.focus-card [data-action=later]').click();
    await expect(title).not.toHaveText(prev);
  }
  // 3件を順に回すので、同じ並びが繰り返される
  expect(seen.slice(0, 3).sort()).toEqual(['A', 'B', 'C']);
  expect(seen.slice(3)).toEqual(seen.slice(0, 3));

  // 後回しでは中身は変わらず、状態も open のまま
  const items = await storedItems(page);
  expect(items.every(i => i.status === 'open' && i.list === 'today')).toBe(true);
});

test('1件表示から完了すると、1件タブの「今日やる」一覧からも消える', async ({ page }) => {
  await openApp(page);
  await addTo(page, 'today', 'ひとつだけ');
  await page.goto('#/focus');
  await expect(page.locator('#focus-dynamic .rows .row')).toHaveCount(1);
  await page.locator('.focus-card [data-action=done]').click();
  await expect(page.locator('#focus-dynamic .rows .row')).toHaveCount(0);
  expect((await storedItems(page))[0].status).toBe('done');
});

test('他の端末の時計が進んでいて未来の時刻が付いた項目があっても、後回しで確実に最後へ回る', async ({ page, context }) => {
  const gh = new FakeGitHub();
  await gh.install(context);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1時間先
  gh.setDoc({ schema_version: 1, items: [remoteItem({ id: 'z-future', text: '時計の進んだ端末から', list: 'today', created_at: future, updated_at: future })] });
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await addTo(page, 'today', '手元の項目');
  await page.goto('#/focus');

  const title = page.locator('.focus-title');
  await expect(title).toHaveText('手元の項目'); // updated_at が古い順なので手元の項目が先
  await page.locator('.focus-card [data-action=later]').click();
  await expect(title).toHaveText('時計の進んだ端末から');
  await page.locator('.focus-card [data-action=later]').click();
  await expect(title).toHaveText('手元の項目');
});
