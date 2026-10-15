// Claude Code への整理の依頼ボタン(データ用リポジトリの GitHub Actions を起動する)
const { test, expect } = require('@playwright/test');
const { FakeGitHub, remoteItem, openApp, capture, storedItems, configureSync, expectSyncState, READONLY_TOKEN } = require('./helpers');

let gh;
test.beforeEach(async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-15T10:00:00+09:00') });
  gh = new FakeGitHub();
  gh.setDoc({ schema_version: 1, items: [] });
  await gh.install(context);
});

test('同期を設定していなければ、整理のボタンは出ない', async ({ page }) => {
  await openApp(page);
  await capture(page, '未整理');
  await expect(page.locator('[data-action=organize]')).toHaveCount(0);
  await page.goto('#/list/inbox');
  await expect(page.locator('[data-action=organize]')).toHaveCount(0);
});

test('インボックスが空ならホームにはボタンを出さず、インボックスの画面には出す', async ({ page }) => {
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await page.goto('#/');
  await expect(page.locator('#home-dynamic [data-action=organize]')).toHaveCount(0);
  await page.goto('#/list/inbox');
  await expect(page.locator('[data-action=organize]')).toBeVisible();
});

test('押すと、未送信の投げ込みを先に送ってから整理を起動し、終わったら結果を取り込む', async ({ page, context }) => {
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await page.goto('#/');
  await capture(page, '歯医者に電話');
  const btn = page.locator('#home-dynamic [data-action=organize]');
  await btn.click();
  await expect(page.locator('#toast-msg')).toHaveText('整理を依頼しました。数分かかります');

  // 起動より前に、投げ込みが GitHub に届いている
  expect(gh.doc().items.map(i => i.text)).toEqual(['歯医者に電話']);
  expect(gh.dispatches).toEqual([{ ref: 'main' }]);
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText('Claude が整理しています');

  // まだ終わっていないあいだは待つ
  await page.clock.runFor(20 * 1000);
  await expect(btn).toBeDisabled();

  // Claude Code が振り分けてコミットした(GitHub 側の変更)
  const d = gh.doc();
  d.items[0] = { ...d.items[0], list: 'todo', estimate_min: 5, updated_at: '2026-10-15T10:01:00+09:00' };
  gh.setDoc(d);
  Object.assign(gh.latestRun(), { status: 'completed', conclusion: 'success' });

  await page.clock.runFor(20 * 1000);
  await expect(page.locator('#toast-msg')).toHaveText('整理が終わりました');
  await expect(page.locator('#home-dynamic [data-action=organize]')).toHaveCount(0); // インボックスが空になった
  const [it] = await storedItems(page);
  expect(it).toMatchObject({ list: 'todo', estimate_min: 5 });
});

test('依頼したあとアプリを開き直しても、続きを見守る', async ({ page }) => {
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await page.goto('#/list/inbox');
  await page.locator('[data-action=organize]').click();
  await expect(page.locator('#toast-msg')).toHaveText('整理を依頼しました。数分かかります');
  await page.reload();
  await expect(page.locator('[data-action=organize]')).toBeDisabled();
  Object.assign(gh.latestRun(), { status: 'completed', conclusion: 'success' });
  await page.clock.runFor(20 * 1000);
  await expect(page.locator('#toast-msg')).toHaveText('整理が終わりました');
  await expect(page.locator('[data-action=organize]')).toBeEnabled();
});

test('整理が失敗したら、その旨を表示してボタンを戻す', async ({ page }) => {
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await page.goto('#/list/inbox');
  await page.locator('[data-action=organize]').click();
  await expect(page.locator('#toast-msg')).toHaveText('整理を依頼しました。数分かかります');
  Object.assign(gh.latestRun(), { status: 'completed', conclusion: 'failure' });
  await page.clock.runFor(20 * 1000);
  await expect(page.locator('#toast-msg')).toContainText('整理に失敗しました');
  await expect(page.locator('[data-action=organize]')).toBeEnabled();
});

test('以前の実行が終わっていても、今回の実行が終わるまでは完了とみなさない', async ({ page }) => {
  gh.runs = [{ id: 500, status: 'completed', conclusion: 'success' }];
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await page.goto('#/list/inbox');
  await page.locator('[data-action=organize]').click();
  await expect(page.locator('#toast-msg')).toHaveText('整理を依頼しました。数分かかります');
  await page.clock.runFor(60 * 1000);
  await expect(page.locator('[data-action=organize]')).toBeDisabled();
  expect(gh.latestRun().id).toBe(501);
});

test('トークンに Actions の権限がなければ、その旨を表示する', async ({ page }) => {
  await openApp(page);
  await configureSync(page, READONLY_TOKEN); // 未送信がなければ読み取りだけで同期は済む
  await expectSyncState(page, 'synced');
  await page.goto('#/list/inbox');
  await page.locator('[data-action=organize]').click();
  await expect(page.locator('#toast-msg')).toContainText('Actions の権限(Read and write)がありません');
  expect(gh.dispatches).toHaveLength(0);
  await expect(page.locator('[data-action=organize]')).toBeEnabled();
});

test('未送信の投げ込みを送れないときは、整理を起動しない', async ({ page }) => {
  await openApp(page);
  await configureSync(page, READONLY_TOKEN);
  await expectSyncState(page, 'synced');
  await page.goto('#/');
  await capture(page, '送れない投げ込み');
  await page.locator('#home-dynamic [data-action=organize]').click();
  await expect(page.locator('#toast-msg')).toContainText('未送信の変更を送れませんでした');
  expect(gh.dispatches).toHaveLength(0);
});

test('データ用リポジトリに整理の仕組みが無ければ、その旨を表示する', async ({ page }) => {
  gh.workflowExists = false;
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await page.goto('#/list/inbox');
  await page.locator('[data-action=organize]').click();
  await expect(page.locator('#toast-msg')).toContainText('整理の仕組み(.github/workflows/organize.yml)が見つかりません');
  await expect(page.locator('[data-action=organize]')).toBeEnabled();
});
