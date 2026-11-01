"""封面索引的 D1 存取（scripts/covers_d1.py）：与服务端同口径的 SQL、差异写入、迁移与核对。
网络层用「真 SQLite 内存库」顶替 Cloudflare REST：SQL 真执行，不是对字符串的断言。"""
import importlib.util
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("covers_d1", ROOT / "scripts" / "covers_d1.py")
d1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d1)

BASE = "/accounts/x/d1/database/y"


class FakeRest:
    """把 REST 的 /query（单条或 batch）转给 sqlite；返回与 Cloudflare 同形状的 {"result": [{"results": [...]}]}"""

    def __init__(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.calls = 0

    def __call__(self, method, path, body=None):
        assert method == "POST" and path == f"{BASE}/query"
        self.calls += 1
        payload = json.loads(body)
        stmts = payload.get("batch") or [payload]
        out = []
        for s in stmts:
            cur = self.db.execute(s["sql"], s.get("params") or [])
            is_select = s["sql"].lstrip().upper().startswith("SELECT")
            out.append({"results": [dict(r) for r in cur.fetchall()] if is_select else [], "meta": {"changes": 0 if is_select else cur.rowcount}})
        self.db.commit()
        return {"result": out}


def idx(**items):
    return {"rev": 7, "items": {k: {"stem": k, "title": k.upper(), "updatedAt": 100, **v} for k, v in items.items()}}


def test_read_index_on_fresh_db_is_empty_and_creates_schema():
    rest = FakeRest()
    assert d1.read_index(rest, BASE) == {"rev": 0, "items": {}}
    tables = {r[0] for r in rest.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"covers_items", "covers_meta"} <= tables


def test_write_diff_only_writes_changed_items_and_bumps_rev():
    rest = FakeRest()
    old = idx(a={}, b={})
    d1.write_diff(rest, BASE, {}, old)
    first = d1.read_index(rest, BASE)
    assert first["items"] == old["items"] and first["rev"] > old["rev"]
    new = {"rev": 8, "items": {**old["items"], "b": {**old["items"]["b"], "author": "乙"}, "c": {"stem": "c", "title": "C", "updatedAt": 200}}}
    assert d1.write_diff(rest, BASE, old["items"], new) == 2  # b 变了、c 新增；a 不动
    got = d1.read_index(rest, BASE)
    assert got["rev"] > 8 and got["items"]["b"]["author"] == "乙" and set(got["items"]) == {"a", "b", "c"}  # rev 与服务端同口径：时间戳单调，不会比应用写出的更小
    before = rest.calls
    assert d1.write_diff(rest, BASE, new["items"], new) == 0 and rest.calls == before  # 没变化：一次请求都不发（不烧写入额度）


def test_diff_statements_has_no_rev_when_nothing_changed():
    same = idx(a={})
    assert d1.diff_statements(same["items"], same) == []


def test_migrate_is_idempotent_and_does_not_overwrite_newer_d1_rows():
    rest = FakeRest()
    kv = idx(a={}, b={})
    assert d1.migrate(rest, BASE, kv) == {"kv_items": 2, "d1_items": 2}
    # 应用在迁移后改过 a：再次迁移（比如手滑重跑）不能把它回滚成 KV 里的旧值
    rest.db.execute("UPDATE covers_items SET json = ? WHERE id = 'a'", [json.dumps({"stem": "a", "title": "新", "updatedAt": 999})])
    rest.db.execute("UPDATE covers_meta SET v = '12345' WHERE k = 'rev'")
    d1.migrate(rest, BASE, kv)
    got = d1.read_index(rest, BASE)
    assert got["items"]["a"]["title"] == "新" and got["rev"] == 12345


def test_compare_reports_missing_extra_and_differing():
    kv = idx(a={}, b={}, c={})
    d1_idx = {"rev": 9, "items": {"a": kv["items"]["a"], "b": {**kv["items"]["b"], "title": "改了"}, "z": {"stem": "z", "title": "Z"}}}
    r = d1.compare(kv, d1_idx)
    assert r == {"kv": 3, "d1": 3, "missing_in_d1": ["c"], "only_in_d1": ["z"], "differ": ["b"]}


def test_write_back_never_overwrites_an_app_write_made_after_the_script_read():
    rest = FakeRest()
    old = idx(a={})
    d1.write_diff(rest, BASE, {}, old)
    snapshot = d1.read_index(rest, BASE)["items"]  # 脚本读到的快照
    # 脚本上传封面期间，应用补传了 a 的 author（updated_at 变了）
    app = {**snapshot["a"], "author": "应用写的", "updatedAt": 5000}
    rest.db.execute("UPDATE covers_items SET json = ?, updated_at = 5000 WHERE id = 'a'", [json.dumps(app)])
    mine = {"rev": 7, "items": {"a": {**snapshot["a"], "pages": 9, "updatedAt": 6000}, "b": {"stem": "b", "title": "B", "updatedAt": 6000}}}
    try:
        d1.write_diff(rest, BASE, snapshot, mine)
    except d1.IndexConflict as e:
        assert e.ids == ["a"]  # 只报被抢先改过的；b 是新书，正常写入
    else:
        raise AssertionError("应当报冲突，而不是静默覆盖")
    got = d1.read_index(rest, BASE)["items"]
    assert got["a"]["author"] == "应用写的" and "pages" not in got["a"]  # 应用的写入原样保留
    assert "b" in got


def test_new_book_conflicts_if_the_app_inserted_the_same_id_first():
    rest = FakeRest()
    d1.ensure_schema(rest, BASE)
    rest.db.execute("INSERT INTO covers_items VALUES ('a', ?, 1)", [json.dumps({"stem": "a", "title": "应用先写", "updatedAt": 1})])
    try:
        d1.write_diff(rest, BASE, {}, idx(a={}))  # 脚本以为 a 不存在
    except d1.IndexConflict as e:
        assert e.ids == ["a"]
    else:
        raise AssertionError("应当报冲突")


def test_d1_database_id_ignores_field_order_and_fails_loudly_when_declared_without_id(tmp_path):
    t = tmp_path / "wrangler.toml"
    reordered = 'name = "x"\n\n[[d1_databases]]\ndatabase_id = "b6e45ad3-6b9f-4120-9876-ad37d4c3cda1"\ndatabase_name = "n"\nbinding = "FASTREADER_DB"\n\n[vars]\n'
    t.write_text(reordered, encoding="utf-8")
    assert d1.d1_database_id(t) == "b6e45ad3-6b9f-4120-9876-ad37d4c3cda1"  # 字段顺序不影响
    # 另一张 D1 表在前、我们的在后：不能串到别的库的 id
    t.write_text('[[d1_databases]]\nbinding = "OTHER"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n\n' + reordered, encoding="utf-8")
    assert d1.d1_database_id(t) == "b6e45ad3-6b9f-4120-9876-ad37d4c3cda1"
    # 声明了绑定却没有合法 id：报错，而不是返回 None 让脚本悄悄去写 KV
    t.write_text('[[d1_databases]]\nbinding = "FASTREADER_DB"\ndatabase_id = "not-a-uuid"\n', encoding="utf-8")
    try:
        d1.d1_database_id(t)
    except ValueError:
        pass
    else:
        raise AssertionError("应当报错")


def test_d1_database_id_is_read_from_wrangler_toml(tmp_path):
    t = tmp_path / "wrangler.toml"
    t.write_text('name = "x"\n\n[[d1_databases]]\nbinding = "FASTREADER_DB"\ndatabase_name = "n"\ndatabase_id = "b6e45ad3-6b9f-4120-9876-ad37d4c3cda1"\n\n[vars]\n', encoding="utf-8")
    assert d1.d1_database_id(t) == "b6e45ad3-6b9f-4120-9876-ad37d4c3cda1"
    t.write_text('name = "x"\n', encoding="utf-8")
    assert d1.d1_database_id(t) is None
