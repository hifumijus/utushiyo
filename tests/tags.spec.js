// タグでまとめて見る
const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers');

async function addTagged(page, list, text, tags, due) {
  await page.goto('#/list/' + list);
  await page.locator('#list-capture-text').fill(text);
  await page.locator('#list-capture-btn').click();
  await expect(page.locator('#list-capture-text')).toHaveValue('');
  await page.locator('.row', { hasText: text }).locator('.row-body').click();
  await page.locator('#edit-tags').fill(tags);
  if (due) await page.locator('#edit-due').fill(due);
  await page.locator('#edit-form button[type=submit]').click();
  await expect(page.locator('#edit-dialog')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addTagged(page, 'chores', '風呂掃除', '家');
  await addTagged(page, 'chores', 'ゴミ出し', '家', '2026-10-15');
  await addTagged(page, 'shopping', '電池', '家、100均');
  await addTagged(page, 'todo', 'メルカリ出品', 'PCの前');
  await addTagged(page, 'todo', '終わった家の用事', '家');
  await page.locator('.row', { hasText: '終わった家の用事' }).locator('.check').click();
});

test('メニューにタグが件数付きで並び、押すとリストをまたいでまとめて見られる', async ({ page }) => {
  await page.goto('#/menu');
  const tagLinks = page.locator('#view-menu a[href^="#/tag/"]');
  await expect(tagLinks.locator('span:first-child')).toHaveText(['家', '100均', 'PCの前']); // 件数の多い順
  await expect(tagLinks.first().locator('.n')).toHaveText('3 ›'); // 完了済みは数えない

  await tagLinks.first().click();
  await expect(page.locator('#title')).toHaveText('タグ: 家');
  await expect(page.locator('#view-tag .section-title')).toHaveText(['家事(2)', '通販で買う(1)']);
  await expect(page.locator('#view-tag .row-title')).toHaveText(['ゴミ出し', '風呂掃除', '電池']); // 期限の近いものが先
  await expect(page.locator('#view-tag')).not.toContainText('終わった家の用事');
  await expect(page.locator('#view-tag')).not.toContainText('メルカリ出品');
});

test('一覧のタグを押すと、項目の編集ではなくそのタグの画面へ移る', async ({ page }) => {
  await page.goto('#/list/shopping');
  await page.locator('.row', { hasText: '電池' }).locator('.tag', { hasText: '100均' }).click();
  await expect(page.locator('#edit-dialog')).toBeHidden();
  await expect(page.locator('#title')).toHaveText('タグ: 100均');
  await expect(page.locator('#view-tag .row-title')).toHaveText(['電池']);
  // タグの画面からも完了・編集ができる
  await page.locator('#view-tag .row .check').click();
  await expect(page.locator('#view-tag .row')).toHaveCount(0);
});
