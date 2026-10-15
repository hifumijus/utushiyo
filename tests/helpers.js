// テスト共通の道具。
// FakeGitHub は GitHub の「Repository contents」API のうち、アプリが使う部分だけを
// 公式ドキュメントの挙動に合わせて真似する(本物の GitHub には一切通信しない)。
const { expect } = require('@playwright/test');

const GOOD_TOKEN = 'test-token-rw';
const READONLY_TOKEN = 'test-token-ro';
const OWNER = 'me';
const REPO = 'data';

// GitHub は base64 を 60 文字ごとに改行して返す
function toGitHubBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
}

class FakeGitHub {
  constructor() {
    this.file = null;       // { sha, text } または null(ファイルなし)
    this.repoExists = true;
    this.shaCounter = 0;
    this.requests = [];     // { method, path, body }
    this.putCount = 0;
    this.conflictsToInject = 0; // 次の PUT を何回 409 にするか(別端末が先に書いた状況)
    // GitHub Actions(整理の仕組み)
    this.workflowExists = true;
    this.runs = [{ id: 100, status: 'completed', conclusion: 'success' }]; // 以前の実行
    this.dispatches = [];
  }

  setDoc(doc) {
    this.file = { sha: 'sha-' + (++this.shaCounter), text: JSON.stringify(doc, null, 2) };
  }
  doc() {
    return this.file ? JSON.parse(this.file.text) : null;
  }
  latestRun() {
    return [...this.runs].sort((a, b) => b.id - a.id)[0];
  }
  item(predicate) {
    return this.doc().items.find(predicate);
  }

  async install(context) {
    await context.route('https://api.github.com/**', route => this.handle(route));
  }

  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    this.requests.push({ method, path: url.pathname, query: url.search, body });
    const json = (status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

    const auth = req.headers()['authorization'] || '';
    const token = auth.replace(/^Bearer /, '');
    if (token !== GOOD_TOKEN && token !== READONLY_TOKEN) return json(401, { message: 'Bad credentials', status: '401' });

    const repoPath = `/repos/${OWNER}/${REPO}`;
    if (!url.pathname.startsWith(repoPath) || !this.repoExists) return json(404, { message: 'Not Found', status: '404' });

    if (url.pathname === repoPath && method === 'GET') return json(200, { full_name: `${OWNER}/${REPO}`, private: true });

    const wf = `${repoPath}/actions/workflows/organize.yml`;
    if (url.pathname.startsWith(wf)) {
      if (!this.workflowExists) return json(404, { message: 'Not Found', status: '404' });
      if (token === READONLY_TOKEN) return json(403, { message: 'Resource not accessible by personal access token', status: '403' });
      if (url.pathname === `${wf}/dispatches` && method === 'POST') {
        this.dispatches.push(body);
        const id = Math.max(0, ...this.runs.map(r => r.id)) + 1;
        this.runs.push({ id, status: 'queued', conclusion: null });
        return route.fulfill({ status: 204, body: '' });
      }
      if (url.pathname === `${wf}/runs` && method === 'GET') {
        const n = Number(url.searchParams.get('per_page') || 30);
        const runs = [...this.runs].sort((a, b) => b.id - a.id).slice(0, n);
        return json(200, { total_count: this.runs.length, workflow_runs: runs });
      }
    }

    if (url.pathname === `${repoPath}/contents/items.json`) {
      if (method === 'GET') {
        if (!this.file) return json(404, { message: 'Not Found', status: '404' });
        return json(200, {
          type: 'file', name: 'items.json', path: 'items.json', sha: this.file.sha,
          encoding: 'base64', content: toGitHubBase64(this.file.text),
        });
      }
      if (method === 'PUT') {
        if (token === READONLY_TOKEN) return json(403, { message: 'Resource not accessible by personal access token', status: '403' });
        if (this.conflictsToInject > 0) {
          // 読み込みと書き込みの間に、別の端末が先に書き込んだ
          this.conflictsToInject--;
          const d = this.doc() || { schema_version: 1, items: [] };
          d.items.push(remoteItem({ id: 'other-device-' + this.shaCounter, text: '別の端末で追加' }));
          this.setDoc(d);
        }
        if (this.file && !body.sha) return json(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.', status: '422' });
        if (this.file && body.sha !== this.file.sha) return json(409, { message: `items.json does not match ${body.sha}`, status: '409' });
        const created = !this.file;
        this.file = { sha: 'sha-' + (++this.shaCounter), text: Buffer.from(body.content, 'base64').toString('utf8') };
        this.putCount++;
        this.lastCommitMessage = body.message;
        this.lastBranch = body.branch;
        return json(created ? 201 : 200, { content: { sha: this.file.sha, path: 'items.json' } });
      }
    }
    return json(404, { message: 'Not Found', status: '404' });
  }
}

// GitHub 側(Claude Code や別の端末)が書いた項目
function remoteItem(over = {}) {
  const t = over.updated_at || '2026-01-01T09:00:00+09:00';
  return {
    id: over.id || 'remote-' + Math.random().toString(36).slice(2),
    text: 'リモートの項目', note: '', list: 'inbox', tags: [], status: 'open', due: null,
    created_at: t, updated_at: t, deleted: false,
    ...over,
  };
}

async function openApp(page, path = '') {
  await page.goto(path);
  await expect(page.locator('#home-dynamic .inbox-link, #view-list:not([hidden]), #view-menu:not([hidden]), #view-settings:not([hidden]), #view-done:not([hidden])').first()).toBeVisible();
}

async function capture(page, text) {
  await page.locator('#capture-text').fill(text);
  await page.locator('#capture-btn').click();
  await expect(page.locator('#capture-text')).toHaveValue('');
}

// 端末内(IndexedDB)に実際に保存されている項目を読む。画面ではなく保存先を確かめるため
async function storedItems(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('nagekomi');
    req.onsuccess = () => {
      const tx = req.result.transaction('items', 'readonly');
      const all = tx.objectStore('items').getAll();
      all.onsuccess = () => { resolve(all.result); req.result.close(); };
      all.onerror = () => reject(all.error);
    };
    req.onerror = () => reject(req.error);
  }));
}

async function configureSync(page, token = GOOD_TOKEN) {
  await page.goto('#/settings');
  await page.locator('#set-owner').fill(OWNER);
  await page.locator('#set-repo').fill(REPO);
  await page.locator('#set-token').fill(token);
  await page.locator('#settings-form button[type=submit]').click();
}

async function expectSyncState(page, state, timeout = 10_000) {
  await expect(page.locator('#sync-chip')).toHaveAttribute('data-state', state, { timeout });
}

module.exports = {
  FakeGitHub, remoteItem, openApp, capture, storedItems, configureSync, expectSyncState,
  GOOD_TOKEN, READONLY_TOKEN, OWNER, REPO,
};
