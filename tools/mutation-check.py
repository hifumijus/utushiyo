"""テストそのものの点検。アプリをわざと壊し、テストがそれを検出できるかを確かめる。

使い方: python3 tools/mutation-check.py
「見逃し」が出たら、その壊し方を検出できるようにテストを足すこと。
アプリを書き換えて置換対象が見つからなくなったら、この一覧も合わせて直すこと。
"""
import re, shutil, subprocess, sys
M = [
 ("同期: 古いほうを採用", "index.html", "if (!r || parseTime(l.updated_at) > parseTime(r.updated_at)) { merged.set(l.id, l); toRemote++; }", "if (!r) { merged.set(l.id, l); toRemote++; }", "sync"),
 ("同期: リモートのほうが新しくても端末を優先", "index.html", "if (!cur || parseTime(it.updated_at) > parseTime(cur.updated_at)) toWrite.push(it);", "if (!cur) toWrite.push(it);", "sync"),
 ("同期: 競合時にやり直さない", "index.html", "if (e instanceof ConflictError) continue;", "", "sync"),
 ("同期: 新しい形式を拒否しない", "index.html", "if (v > SCHEMA_VERSION) throw", "if (false) throw", "sync"),
 ("同期: 壊れたJSONを空とみなす", "index.html", "try { doc = JSON.parse(base64ToUtf8(b64) || '{}'); }", "try { doc = JSON.parse(base64ToUtf8(b64) || '{}'); } catch { doc = {}; } try {", "sync"),
 ("同期: 未知の項目を捨てる", "index.html", "const out = { ...doc, schema_version", "const out = { schema_version", "sync"),
 ("同期: 通信不能をエラー扱いせず止まる", "index.html", "state.offline = false; render(); scheduleSync(500);", "state.offline = false; render();", "sync"),
 ("後回し: 同じ秒で入れ替わらない", "index.html", "await updateItem(id, {}, latest);", "await updateItem(id, {});", "focus"),
 ("1件表示: やることを先に出す", "index.html", "const FOCUS_LISTS = ['today', 'todo'];", "const FOCUS_LISTS = ['todo', 'today'];", "focus"),
 ("削除: deleted でなく archived にする", "index.html", "await updateItem(id, { deleted: true });", "await updateItem(id, { status: 'archived' });", "items"),
 ("編集: 変えていなくても updated_at を更新", "index.html", "if (Object.keys(ch).length) {\n    await updateItem(id, ch);", "if (true) {\n    await updateItem(id, ch);", "items"),
 ("保存: IndexedDB に書かない", "index.html", "for (const it of items) s.put(it);\n      tx.objectStore('meta').put(pendingCopy, 'pending');\n    });\n  } catch", "tx.objectStore('meta').put(pendingCopy, 'pending');\n    });\n  } catch", "capture"),
 ("?add=: URL から消さない", "index.html", "history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);", "", "capture"),
 ("ホーム: ためておくリストも出す", "index.html", "const today = openItemsOf('today');", "const today = [...openItemsOf('today'), ...openItemsOf('movies')];", "items"),
 ("オフライン: キャッシュを使わない", "sw.js", "if (cached) {", "if (false) {", "offline"),
 ("トークン: 設定画面に表示してしまう", "index.html", "$('#set-token').value = '';", "$('#set-token').value = state.token;", "sync"),
]
bad = []
for name, f, a, b, spec in M:
    src = open(f).read()
    if src.count(a) != 1: print("!! 置換対象が見つからない:", name); bad.append(name); continue
    shutil.copy(f, f + ".bak")
    open(f, "w").write(src.replace(a, b))
    r = subprocess.run(["npx", "playwright", "test", f"tests/{spec}.spec.js", "--reporter=line"], capture_output=True, text=True)
    shutil.move(f + ".bak", f)
    failed = re.search(r"(\d+) failed", r.stdout)
    print(("検出 " if r.returncode else "見逃し"), f"[{failed.group(1) if failed else 0}件失敗]", name)
    if not r.returncode: bad.append(name)
print("見逃し:", bad or "なし")
sys.exit(1 if bad else 0)
