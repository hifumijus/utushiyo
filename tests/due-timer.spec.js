// 期限(今日・今週・日付)、見込み時間、タイマー
const { test, expect } = require('@playwright/test');
const { openApp, storedItems } = require('./helpers');

// 2026-10-15 は木曜日。「今週」は日曜の 10/18
const THURSDAY = new Date('2026-10-15T10:00:00+09:00');

async function addTo(page, list, text) {
  await page.goto('#/list/' + list);
  await page.locator('#list-capture-text').fill(text);
  await page.locator('#list-capture-btn').click();
  await expect(page.locator('#list-capture-text')).toHaveValue('');
}
async function byText(page, text) {
  return (await storedItems(page)).find(i => i.text === text);
}
async function editRow(page, text) {
  await page.locator('.row', { hasText: text }).first().locator('.row-body').click();
  await expect(page.locator('#edit-dialog')).toBeVisible();
}
async function save(page) {
  await page.locator('#edit-form button[type=submit]').click();
  await expect(page.locator('#edit-dialog')).toBeHidden();
}

test.describe('期限', () => {
  test.beforeEach(async ({ page }) => { await page.clock.install({ time: THURSDAY }); });

  test('編集画面の「今日」「今週」「日付」「なし」で期限を付け外しできる', async ({ page }) => {
    await openApp(page);
    await addTo(page, 'todo', '期限テスト');
    const dlg = page.locator('#edit-dialog');

    await editRow(page, '期限テスト');
    await dlg.locator('.due-picker [data-set=today]').click();
    await expect(dlg.locator('.due-picker [data-set=today]')).toHaveClass(/on/);
    await save(page);
    expect((await byText(page, '期限テスト')).due).toBe('2026-10-15');
    await expect(page.locator('.row', { hasText: '期限テスト' }).locator('.due-today')).toHaveText('今日まで');

    await editRow(page, '期限テスト');
    await dlg.locator('.due-picker [data-set=week]').click();
    await save(page);
    expect((await byText(page, '期限テスト')).due).toBe('2026-10-18');
    await expect(page.locator('.row', { hasText: '期限テスト' })).toContainText('10/18(日)まで');

    await editRow(page, '期限テスト');
    await page.locator('#edit-due').fill('2026-11-03');
    await save(page);
    expect((await byText(page, '期限テスト')).due).toBe('2026-11-03');

    await editRow(page, '期限テスト');
    await dlg.locator('.due-picker [data-set=""]').click();
    await save(page);
    expect((await byText(page, '期限テスト')).due).toBeNull();
  });

  test('日曜に「今週」を選ぶと、その日が期限になる', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-18T10:00:00+09:00'));
    await openApp(page);
    await addTo(page, 'todo', '日曜の項目');
    await editRow(page, '日曜の項目');
    await page.locator('#edit-dialog .due-picker [data-set=week]').click();
    await save(page);
    expect((await byText(page, '日曜の項目')).due).toBe('2026-10-18');
  });

  test('期限切れは赤、今日までは橙で表示する', async ({ page }) => {
    await openApp(page);
    await addTo(page, 'chores', '過ぎたもの');
    await editRow(page, '過ぎたもの');
    await page.locator('#edit-due').fill('2026-10-14');
    await save(page);
    const row = page.locator('.row', { hasText: '過ぎたもの' });
    await expect(row.locator('.due-overdue')).toHaveText('期限切れ 10/14(水)');
    await expect(row.locator('.due-overdue')).toHaveCSS('color', /rgb/);
  });

  test('投げ込み時に期限と見込み時間を付けられ、追加後は指定が元に戻る', async ({ page }) => {
    await openApp(page);
    const form = page.locator('#capture-form');
    await form.locator('.opts-btn').click();
    await form.locator('.due-picker [data-set=week]').click();
    await form.locator('.est-picker [data-set="15"]').click();
    await expect(form.locator('.opts-btn')).toContainText('10/18(日)まで・15分');
    await page.locator('#capture-text').fill('期限付きの投げ込み');
    await page.locator('#capture-btn').click();
    const it = await byText(page, '期限付きの投げ込み');
    expect(it).toMatchObject({ due: '2026-10-18', estimate_min: 15, list: 'inbox' });

    await expect(form.locator('.capture-opts')).toBeHidden();
    await expect(form.locator('.opts-btn')).toHaveText('期限・見込み ▾');
    await page.locator('#capture-text').fill('指定なし');
    await page.locator('#capture-btn').click();
    expect(await byText(page, '指定なし')).toMatchObject({ due: null, estimate_min: null });
  });

  test('まとめて追加でも、指定した期限と見込み時間が全件に付く', async ({ page }) => {
    await openApp(page);
    const form = page.locator('#capture-form');
    await form.locator('.split-check').check();
    await form.locator('.opts-btn').click();
    await form.locator('.due-picker [data-set=today]').click();
    await form.locator('.est-picker input').fill('20');
    await page.locator('#capture-text').fill('A\nB');
    await page.locator('#capture-btn').click();
    const items = await storedItems(page);
    expect(items).toHaveLength(2);
    for (const it of items) expect(it).toMatchObject({ due: '2026-10-15', estimate_min: 20 });
  });

  test('1件表示では、期限切れ・今日までのものをどのリストからでも先に出し、後回しで優先から外す', async ({ page }) => {
    await openApp(page);
    await addTo(page, 'today', '今日やる項目');
    await addTo(page, 'shopping', '今日までに買う');
    await addTo(page, 'books', '期限切れの本');
    await addTo(page, 'chores', '来週の家事');
    for (const [text, due] of [['今日までに買う', '2026-10-15'], ['期限切れの本', '2026-10-10'], ['来週の家事', '2026-10-22']]) {
      await page.goto('#/menu');
      await page.goto('#/list/' + { 今日までに買う: 'shopping', 期限切れの本: 'books', 来週の家事: 'chores' }[text]);
      await editRow(page, text);
      await page.locator('#edit-due').fill(due);
      await save(page);
    }
    await page.goto('#/');
    const title = page.locator('.focus-title');
    await expect(page.locator('.focus-meta')).toContainText('残り 3 件'); // 来週の家事は入らない
    await expect(title).toHaveText('期限切れの本');
    await page.locator('.focus-card [data-action=later]').click();
    await expect(title).toHaveText('今日までに買う');
    await page.locator('.focus-card [data-action=later]').click();
    await expect(title).toHaveText('今日やる項目');
    await page.locator('.focus-card [data-action=later]').click();
    // 後回しにした期限の迫った項目は、その日は優先から外れ、今日やると同じ列で順に回る
    await expect(title).toHaveText('期限切れの本');
    await expect(page.locator('.focus-meta')).toContainText('残り 3 件');
    await page.reload();
    await expect(page.locator('.focus-title')).toHaveText('期限切れの本');
  });
});

test.describe('見込み時間とタイマー', () => {
  // 時計の自然な進みを止め、テストが runFor で進めた分だけ時間が経つようにする(画面操作の待ち時間で計測値がぶれないように)
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: new Date(THURSDAY.getTime() - 5000) });
    await page.clock.pauseAt(THURSDAY);
  });

  async function setupOne(page, text = '作業A', est = '15') {
    await openApp(page);
    await addTo(page, 'today', text);
    if (est) {
      await editRow(page, text);
      await page.locator(`#edit-dialog .est-picker [data-set="${est}"]`).click();
      await save(page);
    }
    await page.goto('#/');
    await expect(page.locator('.focus-title')).toHaveText(text);
  }

  test('開始すると時間が進み、完了で実績と完了時刻が記録される', async ({ page }) => {
    await setupOne(page);
    await expect(page.locator('.focus-card')).toContainText('目安 15分');
    await page.locator('.focus-card [data-action=start]').click();
    await expect(page.locator('[data-timer]')).toHaveText('00:00');
    await page.clock.runFor(5 * 60 * 1000);
    await expect(page.locator('[data-timer]')).toHaveText('05:00');
    await expect(page.locator('.focus-timer')).toContainText('計測中 ・ 目安 15分');

    await page.locator('.focus-card [data-action=done]').click();
    await expect(page.locator('#toast-msg')).toHaveText('完了: 実際 5分 / 目安 15分');
    const it = await byText(page, '作業A');
    expect(it).toMatchObject({ status: 'done', spent_sec: 300, timer_started_at: null, done_at: '2026-10-15T10:05:00+09:00', estimate_min: 15 });
  });

  test('一時停止中の時間は数えず、再開すると続きから足し合わせる', async ({ page }) => {
    await setupOne(page);
    await page.locator('.focus-card [data-action=start]').click();
    await page.clock.runFor(3 * 60 * 1000);
    await page.locator('.focus-card [data-action=pause]').click();
    await expect(page.locator('.focus-timer')).toContainText('一時停止中');
    await page.clock.runFor(10 * 60 * 1000);
    await expect(page.locator('[data-timer]')).toHaveText('03:00');
    await page.locator('.focus-card [data-action=start]').click(); // 「再開」
    await page.clock.runFor(2 * 60 * 1000);
    await page.locator('.focus-card [data-action=done]').click();
    expect((await byText(page, '作業A')).spent_sec).toBe(300);
  });

  test('目安を超えると表示が変わる', async ({ page }) => {
    await setupOne(page, '短い作業', '5');
    await page.locator('.focus-card [data-action=start]').click();
    await expect(page.locator('.focus-timer')).not.toHaveClass(/over/);
    await page.clock.runFor(6 * 60 * 1000);
    await expect(page.locator('.focus-timer')).toHaveClass(/over/);
  });

  test('アプリを閉じても計測は続き、計測中の項目が1件表示の先頭に出る', async ({ page }) => {
    await openApp(page);
    await addTo(page, 'today', '先の項目');
    await addTo(page, 'today', '計測する項目');
    await page.goto('#/list/today');
    await page.locator('.row', { hasText: '計測する項目' }).locator('.row-body').click();
    await page.locator('#edit-cancel').click();
    await page.goto('#/');
    await expect(page.locator('.focus-title')).toHaveText('先の項目');
    await page.locator('.focus-card [data-action=later]').click();
    await expect(page.locator('.focus-title')).toHaveText('計測する項目');
    await page.locator('.focus-card [data-action=start]').click();
    await page.clock.runFor(60 * 1000);
    await page.reload();
    await page.clock.runFor(60 * 1000);
    await expect(page.locator('.focus-title')).toHaveText('計測する項目');
    await expect(page.locator('[data-timer]')).toHaveText('02:00');
  });

  test('後回しにすると計測は一時停止し、それまでの時間は残る', async ({ page }) => {
    await openApp(page);
    await addTo(page, 'today', 'X');
    await addTo(page, 'today', 'Y');
    await page.goto('#/');
    const first = await page.locator('.focus-title').textContent();
    await page.locator('.focus-card [data-action=start]').click();
    await page.clock.runFor(4 * 60 * 1000);
    await page.locator('.focus-card [data-action=later]').click();
    await expect(page.locator('#toast-msg')).toHaveText('一時停止して後回しにしました');
    const it = await byText(page, first);
    expect(it).toMatchObject({ timer_started_at: null, spent_sec: 240, status: 'open' });
  });

  test('計測は同時に1件だけ。計測中に別の項目を始めると、前の項目は一時停止する', async ({ page }) => {
    await openApp(page);
    for (const t of ['P', 'Q']) {
      await addTo(page, 'today', t);
      await editRow(page, t);
      await page.locator('#edit-est').fill('10');
      await save(page);
    }
    await page.goto('#/');
    const first = await page.locator('.focus-title').textContent();
    const second = first === 'P' ? 'Q' : 'P';
    await page.locator('.focus-card [data-action=start]').click();
    await page.clock.runFor(60 * 1000);
    // 計測中のまま、「条件で探す」の結果から別の項目を始める
    await page.locator('[data-action=toggle-search]').click();
    await page.locator('.row', { hasText: second }).locator('[data-action=start]').click();
    await expect(page.locator('#toast-msg')).toHaveText('計測を切り替えました');
    await expect(page.locator('.focus-title')).toHaveText(second);
    const items = await storedItems(page);
    expect(items.filter(i => i.timer_started_at).map(i => i.text)).toEqual([second]);
    expect(items.find(i => i.text === first)).toMatchObject({ spent_sec: 60, timer_started_at: null });
  });

  test('完了を元に戻すと未完了に戻り、完了時刻は消える', async ({ page }) => {
    await setupOne(page);
    await page.locator('.focus-card [data-action=done]').click();
    await page.locator('#toast-action').click();
    await expect(page.locator('.focus-title')).toHaveText('作業A');
    expect(await byText(page, '作業A')).toMatchObject({ status: 'open', done_at: null });
  });

  test('完了した項目には一覧で実績と目安が出る', async ({ page }) => {
    await setupOne(page);
    await page.locator('.focus-card [data-action=start]').click();
    await page.clock.runFor(20 * 60 * 1000);
    await page.locator('.focus-card [data-action=done]').click();
    await page.goto('#/done');
    await expect(page.locator('#view-done .row')).toContainText('実際 20分(目安 15分)');
  });
});
