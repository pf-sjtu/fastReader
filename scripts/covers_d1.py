"""书库索引的 D1 存取（Cloudflare REST）：与 functions/_lib/coversStore.js 的表结构、SQL 同口径。

covers_prepare.py --upload 在 wrangler.toml 声明了 D1 时用它读 / 写索引（封面图仍写 KV）；
一次性迁移：python scripts/covers_d1.py migrate   （KV 的 covers:index → D1，幂等，只读 KV）
核对：        python scripts/covers_d1.py verify
纯函数（构造 SQL / 算差异）不碰网络，可单测；IO 函数都接收 `call(method, path, body)`，由调用方注入。
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

SCHEMA = [
    "CREATE TABLE IF NOT EXISTS covers_items (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS covers_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
]
UPSERT_ITEM = "INSERT INTO covers_items (id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at"
UPSERT_REV = "INSERT INTO covers_meta (k, v) VALUES ('rev', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
BATCH = 80

Call = Callable[[str, str, bytes | None], object]


def d1_database_id(toml_path: Path = Path("wrangler.toml")) -> str | None:
    """wrangler.toml 里 FASTREADER_DB 绑定的 database_id（不依赖字段顺序）；没声明 = 还没启用 D1（None）。
    声明了绑定却解析不出 id 会直接报错：悄悄返回 None 会让脚本退回去写应用已经不读的 KV 索引（静默分叉）。"""
    text = toml_path.read_text(encoding="utf-8")
    for block in re.split(r"^\s*\[\[d1_databases\]\]\s*$", text, flags=re.M)[1:]:
        block = re.split(r"^\s*\[", block, maxsplit=1, flags=re.M)[0]  # 只取这一段表，到下一个 [table] 为止
        if re.search(r'^\s*binding\s*=\s*"FASTREADER_DB"', block, flags=re.M):
            m = re.search(r'^\s*database_id\s*=\s*"([0-9a-f-]{36})"', block, flags=re.M)
            if not m:
                raise ValueError("wrangler.toml 声明了 FASTREADER_DB 绑定，但没有合法的 database_id")
            return m.group(1)
    return None


def _stmt(sql: str, params: list | None = None) -> dict:
    return {"sql": sql, "params": params or []}


def _dumps(item: dict) -> str:
    return json.dumps(item, ensure_ascii=False, separators=(",", ":"))


def item_stmt(bid: str, item: dict, old: dict | None = None) -> dict:
    """逐书 CAS 写入（与服务端同款）：只有行的 updated_at 仍是读到的值才写；新书（old=None）要求行不存在。
    脚本是基于「上传封面之前读到的快照」写回的，期间应用补传了元数据就不能被覆盖。"""
    prev = None if old is None else int(old.get("updatedAt") or 0)
    return _stmt(UPSERT_ITEM + " WHERE covers_items.updated_at IS ?", [bid, _dumps(item), int(item.get("updatedAt") or 0), prev])


def diff_statements(old_items: dict, new_index: dict) -> list[dict]:
    """新索引相对旧条目的差异：只写 JSON 变了的条目（不烧写入额度），有写入再补一条 rev（与服务端同样的 ETag 语义）"""
    stmts = [item_stmt(bid, it, old_items.get(bid)) for bid, it in new_index["items"].items() if old_items.get(bid) != it]
    if stmts:
        stmts.append(_stmt(UPSERT_REV, [str(next_rev(int(new_index.get("rev") or 0)))]))
    return stmts


def _batch(call: Call, base: str, stmts: list[dict]) -> list[dict]:
    """分批发送，返回每条语句的结果（含 meta.changes），顺序与 stmts 一致"""
    out: list[dict] = []
    for i in range(0, len(stmts), BATCH):
        res = call("POST", f"{base}/query", json.dumps({"batch": stmts[i : i + BATCH]}).encode("utf-8"))
        out.extend(res["result"])  # type: ignore[index]
    return out


class IndexConflict(RuntimeError):
    """写回时这些书已被别人（应用）抢先修改：没有被覆盖，重跑即可基于最新数据重新合并"""

    def __init__(self, ids: list[str]):
        super().__init__(f"{len(ids)} 本书在脚本读取之后被应用修改过，未覆盖：{ids[:10]}…重跑脚本即可")
        self.ids = ids


def next_rev(prev: int) -> int:
    """与 functions/_lib/coversStore.js#nextRev 同口径：单调且几乎不撞车（时间戳 × 1000 + 随机尾数）"""
    import random
    import time

    return max(prev + 1, int(time.time() * 1000) * 1000 + random.randrange(1000))


def ensure_schema(call: Call, base: str) -> None:
    _batch(call, base, [_stmt(s) for s in SCHEMA])


def read_index(call: Call, base: str) -> dict:
    """读 D1 里的索引 {rev, items}（表还不存在 / 没数据 = 空）"""
    ensure_schema(call, base)
    res = call("POST", f"{base}/query", json.dumps({"batch": [_stmt("SELECT v FROM covers_meta WHERE k = 'rev'"), _stmt("SELECT id, json FROM covers_items")]}).encode("utf-8"))
    rev_rows, item_rows = (r["results"] for r in res["result"])  # type: ignore[index]
    return {"rev": int(rev_rows[0]["v"]) if rev_rows else 0, "items": {r["id"]: json.loads(r["json"]) for r in item_rows}}


def write_diff(call: Call, base: str, old_items: dict, new_index: dict) -> int:
    stmts = diff_statements(old_items, new_index)
    if not stmts:
        return 0  # 没有变化：不发任何请求（不烧写入额度）
    ensure_schema(call, base)
    results = _batch(call, base, stmts)
    ids = [s["params"][0] for s in stmts[:-1]]
    lost = [bid for bid, r in zip(ids, results) if not (r.get("meta") or {}).get("changes")]
    if lost:
        raise IndexConflict(lost)
    return len(stmts) - 1


def migrate(call: Call, base: str, kv_index: dict) -> dict:
    """KV 旧索引 → D1：INSERT OR IGNORE（已在 D1 的条目不覆盖，应用可能已经写过更新的），rev 行最后写且只在缺失时写"""
    ensure_schema(call, base)
    items = kv_index.get("items") or {}
    stmts = [
        _stmt("INSERT OR IGNORE INTO covers_items (id, json, updated_at) VALUES (?, ?, ?)", [bid, json.dumps(it, ensure_ascii=False, separators=(",", ":")), int(it.get("updatedAt") or 0)])
        for bid, it in items.items()
    ]
    _batch(call, base, stmts)
    _batch(call, base, [_stmt("INSERT OR IGNORE INTO covers_meta (k, v) VALUES ('rev', ?)", [str(int(kv_index.get("rev") or 0))])])
    return {"kv_items": len(items), "d1_items": len(read_index(call, base)["items"])}


def compare(kv_index: dict, d1_index: dict) -> dict:
    """迁移核对：KV 里有而 D1 缺的、内容不一致的（D1 已被应用写过更新属正常，单独报）"""
    kv, d1 = kv_index.get("items") or {}, d1_index["items"]
    return {
        "kv": len(kv),
        "d1": len(d1),
        "missing_in_d1": sorted(set(kv) - set(d1)),
        "only_in_d1": sorted(set(d1) - set(kv)),
        "differ": sorted(b for b in set(kv) & set(d1) if kv[b] != d1[b]),
    }


def _main() -> int:  # pragma: no cover - 真实环境入口
    import argparse
    import sys
    import urllib.parse

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import covers_prepare as cp

    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["migrate", "verify"])
    args = ap.parse_args()
    token, db, ns = cp.cf_token(), d1_database_id(), cp.kv_namespace_id()
    if not (token and db and ns):
        raise SystemExit("缺少 token / wrangler.toml 里的 D1 绑定 / KV 命名空间")
    acct = cp.cf_call(token, "GET", "/accounts")["result"][0]["id"]

    def call(method: str, path: str, body: bytes | None = None):
        return cp.cf_call(token, method, path, body)

    base = f"/accounts/{acct}/d1/database/{db}"
    raw = cp.cf_call(token, "GET", f"/accounts/{acct}/storage/kv/namespaces/{ns}/values/{urllib.parse.quote('covers:index', safe='')}")
    kv_index = raw if isinstance(raw, dict) else json.loads(raw)
    if args.cmd == "migrate":
        print(json.dumps(migrate(call, base, kv_index), ensure_ascii=False))
    print(json.dumps(compare(kv_index, read_index(call, base)), ensure_ascii=False)[:1500])
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
