"""封面直写 KV：写入集合的组装规则（与 functions/_lib/covers.js#putItems 同语义）、元数据清洗、命名空间解析"""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("covers_prepare", ROOT / "scripts" / "covers_prepare.py")
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)


def item(i, image: str | None = "QUJD", **meta):
    return {"id": i, "meta": {"stem": "s" + i, "title": "T" + i, **meta}, **({"image": image} if image else {})}


def keys(writes):
    return [w["key"] for w in writes]


def test_new_book_writes_cover_and_index_last():
    writes, idx, tally = cp.build_kv_writes([item("bk_a")], {})
    assert keys(writes) == ["cover:bk_a", "covers:index"]  # 索引最后写：封面失败时不留指向空封面的条目
    assert tally == {"stored": 1, "exists": 0, "meta": 0}
    assert idx["items"]["bk_a"]["cover"] == 1
    assert json.loads(writes[-1]["value"]) == idx


def test_existing_cover_not_overwritten_but_meta_merged():
    old = {"items": {"bk_a": {"stem": "s", "title": "旧", "cover": 1}}}
    writes, idx, tally = cp.build_kv_writes([item("bk_a", author="新作者")], old)
    assert keys(writes) == ["covers:index"]  # 没有重复写封面 = 不烧写入额度
    assert tally["exists"] == 1 and tally["stored"] == 0
    assert idx["items"]["bk_a"]["author"] == "新作者" and idx["items"]["bk_a"]["cover"] == 1


def test_overwrite_forces_cover_write():
    old = {"items": {"bk_a": {"cover": 1}}}
    writes, _, tally = cp.build_kv_writes([item("bk_a")], old, overwrite=True)
    assert "cover:bk_a" in keys(writes) and tally["stored"] == 1


def test_no_image_only_meta_and_no_cover_flag():
    writes, idx, tally = cp.build_kv_writes([item("bk_b", image=None)], {})
    assert keys(writes) == ["covers:index"] and tally["meta"] == 1
    assert "cover" not in idx["items"]["bk_b"]


def test_other_books_in_existing_index_are_preserved():
    old = {"items": {"bk_keep": {"stem": "k", "title": "K", "cover": 1}}}
    _, idx, _ = cp.build_kv_writes([item("bk_a")], old)
    assert "bk_keep" in idx["items"] and "bk_a" in idx["items"]


def test_clean_meta_clips_and_drops_junk():
    m = cp.clean_meta({"stem": " x " * 200, "title": "t", "author": "", "pages": "12", "chapterCount": -3, "junk": 1})
    assert len(m["stem"]) <= 240 and m["title"] == "t"
    assert "author" not in m and "chapterCount" not in m and "junk" not in m
    assert m["pages"] == 12
    assert cp.clean_meta({"pages": 10**9})["pages"] == 100000


def test_kv_namespace_id_is_read_from_wrangler_toml():
    ns = cp.kv_namespace_id(ROOT / "wrangler.toml")
    assert ns and len(ns) == 32
