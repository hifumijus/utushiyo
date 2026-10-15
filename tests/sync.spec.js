// GitHub との同期と同期状態の表示(本物の GitHub ではなく FakeGitHub を相手にする)
const { test, expect } = require('@playwright/test');
const {
  FakeGitHub, remoteItem, openApp, capture, storedItems, configureSync, expectSyncState,
  READONLY_TOKEN,
} = require('./helpers');

let gh;
test.beforeEach(async ({ context }) => {
  gh = new FakeGitHub();
  await gh.install(context);
});

const puts = () => gh.requests.filter(r => r.method === 'PUT');

test('トークン未設定のあいだは GitHub に一切通信しない', async ({ page }) => {
  await openApp(page);
  await capture(page, '端末内だけ');
  await page.waitForTimeout(2500); // 変更後の同期待ち時間(1.5秒)を過ぎても
  expect(gh.requests).toHaveLength(0);
  await expect(page.locator('#sync-label')).toHaveText('端末内のみ');
});

test('初回の同期で items.json を作り、端末内の項目をすべて書き込む', async ({ page }) => {
  await openApp(page);
  await capture(page, '一つ目');
  await capture(page, '二つ目');
  await configureSync(page);
  await expectSyncState(page, 'synced');

  const doc = gh.doc();
  expect(doc.schema_version).toBe(1);
  expect(doc.items.map(i => i.text).sort()).toEqual(['一つ目', '二つ目']);
  expect(gh.lastBranch).toBe('main');
  expect(gh.lastCommitMessage).toContain('items.json');
  expect(gh.file.text).toContain('\n  "items": ['); // Claude Code や人が読みやすいよう整形して保存
  await expect(page.locator('#settings-status')).toContainText('未送信: 0 件');
});

test('トークンは設定画面に再表示しない', async ({ page }) => {
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await page.reload();
  await expect(page.locator('#set-token')).toHaveValue('');
  await expect(page.locator('#token-note')).toContainText('設定済み');
  expect(await page.content()).not.toContain('test-token');
});

test('無効なトークンではエラーを表示し、書き込まない', async ({ page }) => {
  await openApp(page);
  await capture(page, 'あ');
  await configureSync(page, 'wrong-token');
  await expectSyncState(page, 'error');
  await expect(page.locator('#settings-status')).toContainText('アクセストークンが無効か、期限切れです');
  expect(puts()).toHaveLength(0);
  expect((await storedItems(page))).toHaveLength(1); // 端末内のデータは無事
});

test('書き込み権限のないトークンでは、その旨を表示する', async ({ page }) => {
  await openApp(page);
  await capture(page, 'あ');
  await configureSync(page, READONLY_TOKEN);
  await expectSyncState(page, 'error');
  await expect(page.locator('#settings-status')).toContainText('書き込み権限');
});

test('リポジトリが見つからないときは、その旨を表示する', async ({ page }) => {
  gh.repoExists = false;
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'error');
  await expect(page.locator('#settings-status')).toContainText('リポジトリが見つかりません');
});

test('項目ごとに突き合わせ、updated_at が新しいほうを採用し、片方にしかない項目は残す', async ({ page }) => {
  // GitHub 側: Claude Code が振り分けた項目(未来の時刻 = 端末より新しい)と、古い時刻の項目
  const sorted = remoteItem({ id: 'sorted', text: '振り分け済み', list: 'books', updated_at: '2099-01-01T09:00:00+09:00', extra_field: 'x' });
  const old = remoteItem({ id: 'old', text: '古い内容', updated_at: '2026-01-01T09:00:00+09:00' });
  const remoteOnly = remoteItem({ id: 'remote-only', text: 'GitHub にだけある' });
  gh.setDoc({ schema_version: 1, items: [sorted, old, remoteOnly], note_for_future: 'keep' });

  await openApp(page);
  await capture(page, '端末にだけある');
  await configureSync(page);
  await expectSyncState(page, 'synced');

  // 端末側に GitHub の項目が入り、未知の項目(extra_field)も保たれる
  let local = await storedItems(page);
  expect(local.map(i => i.id)).toEqual(expect.arrayContaining(['sorted', 'old', 'remote-only']));
  expect(local.find(i => i.id === 'sorted')).toMatchObject({ list: 'books', extra_field: 'x' });

  // 端末で「古い内容」を編集 → 端末のほうが新しいので GitHub に反映される
  await page.goto('#/list/inbox');
  await page.locator('#list-dynamic .row', { hasText: '古い内容' }).locator('.row-body').click();
  await page.locator('#edit-text').fill('端末で直した内容');
  await page.locator('#edit-form button[type=submit]').click();
  await expect.poll(() => gh.item(i => i.id === 'old').text, { timeout: 10_000 }).toBe('端末で直した内容');
  await expectSyncState(page, 'synced');

  const doc = gh.doc();
  expect(doc.items.map(i => i.text).sort()).toEqual(['GitHub にだけある', '振り分け済み', '端末で直した内容', '端末にだけある'].sort());
  expect(doc.note_for_future).toBe('keep'); // ファイル全体の未知の項目も消さない
  expect(gh.item(i => i.id === 'sorted').extra_field).toBe('x');
});

test('GitHub 側の削除(deleted: true)や完了は、端末にも反映される', async ({ page }) => {
  gh.setDoc({ schema_version: 1, items: [remoteItem({ id: 'a', text: '消される項目', list: 'today' })] });
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await page.goto('#/focus');
  await expect(page.locator('.focus-title')).toHaveText('消される項目');

  const d = gh.doc();
  d.items[0] = { ...d.items[0], deleted: true, updated_at: '2099-01-01T09:00:00+09:00' };
  gh.setDoc(d);
  await page.locator('#sync-chip').click();
  await page.locator('[data-action=sync-now]').click();
  await expectSyncState(page, 'synced');
  await page.goto('#/focus');
  await expect(page.locator('.focus-card')).toContainText('空です');
});

test('変更がなければ GitHub に書き込まない', async ({ page }) => {
  gh.setDoc({ schema_version: 1, items: [remoteItem({ id: 'a' })] });
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  expect(puts()).toHaveLength(0);
});

test('書き込み時に競合したら、取得からやり直して両方の変更を残す', async ({ page }) => {
  gh.setDoc({ schema_version: 1, items: [] });
  gh.conflictsToInject = 2; // 2回続けて別の端末に先を越される
  await openApp(page);
  await capture(page, 'この端末の追加');
  await configureSync(page);
  await expectSyncState(page, 'synced');

  const texts = gh.doc().items.map(i => i.text);
  expect(texts).toContain('この端末の追加');
  expect(texts.filter(t => t === '別の端末で追加')).toHaveLength(2);
  expect((await storedItems(page)).map(i => i.text)).toEqual(expect.arrayContaining(['別の端末で追加']));
});

test('通信できないあいだは「未送信」と表示し、通信が戻ると自動で送る', async ({ page, context }) => {
  gh.setDoc({ schema_version: 1, items: [] });
  await openApp(page);
  await configureSync(page);
  await expectSyncState(page, 'synced');
  await page.goto('#/');

  await context.setOffline(true);
  await capture(page, '圏外での追加');
  await expect(page.locator('#sync-label')).toHaveText('未送信 1', { timeout: 10_000 });
  await page.waitForTimeout(2500); // 入力直後に予約された同期(1.5秒後)が圏外で空振りするのを待つ
  await expect(page.locator('#sync-label')).toHaveText('未送信 1');
  expect(gh.doc().items).toHaveLength(0);

  await context.setOffline(false);
  await expectSyncState(page, 'synced');
  expect(gh.doc().items.map(i => i.text)).toEqual(['圏外での追加']);
});

test('GitHub 側のデータが新しい形式なら、書き込まずに更新を促す', async ({ page }) => {
  gh.setDoc({ schema_version: 2, items: [] });
  await openApp(page);
  await capture(page, 'あ');
  await configureSync(page);
  await expectSyncState(page, 'error');
  await expect(page.locator('#settings-status')).toContainText('新しい形式');
  expect(puts()).toHaveLength(0);
});

test('GitHub 側の items.json が壊れていたら、上書きせずにエラーを表示する', async ({ page }) => {
  gh.file = { sha: 'broken', text: '{ "schema_version": 1, "items": [ ' };
  await openApp(page);
  await capture(page, 'あ');
  await configureSync(page);
  await expectSyncState(page, 'error');
  await expect(page.locator('#settings-status')).toContainText('JSON として読めません');
  expect(puts()).toHaveLength(0);
});

test('トークンを削除すると同期が止まり、端末内のデータは残る', async ({ page }) => {
  await openApp(page);
  await capture(page, '残るデータ');
  await configureSync(page);
  await expectSyncState(page, 'synced');
  page.once('dialog', d => d.accept());
  await page.locator('#token-clear').click();
  await expectSyncState(page, 'local');
  const before = gh.requests.length;
  await page.goto('#/');
  await capture(page, 'トークン削除後');
  await page.waitForTimeout(2500);
  expect(gh.requests.length).toBe(before);
  expect(await storedItems(page)).toHaveLength(2);
});
