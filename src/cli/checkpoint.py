"""
章节级断点续跑

每完成一章即把摘要落盘到 {localDir}/.checkpoints/{sanitizedName}.json；
重跑同一本书时，键（章节标题+正文哈希、模型、prompt 版本、书籍类型、输出语言）
完全一致的章节直接复用，不再调用 AI。整本成功后清除。
"""

import hashlib
import json
import os
import threading
from pathlib import Path
from typing import Optional

CHECKPOINT_DIR_NAME = ".checkpoints"


class ChapterCheckpoint:
    """线程安全的章节结果缓存（原子写）"""

    def __init__(self, path: Path, model: str, prompt_version: str, book_type: str, language: str):
        self.path = Path(path)
        self._salt = "\0".join([model or "", prompt_version or "", book_type or "", language or ""])
        self._lock = threading.Lock()
        self._data: dict = {}
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    self._data = loaded
            except (OSError, ValueError):
                # 损坏的中间文件直接丢弃，按全新处理
                self._data = {}

    @classmethod
    def for_book(cls, local_dir: str, sanitized_name: str, **kwargs) -> "ChapterCheckpoint":
        return cls(Path(local_dir) / CHECKPOINT_DIR_NAME / f"{sanitized_name}.json", **kwargs)

    def key(self, title: str, content: str) -> str:
        digest = hashlib.sha256(f"{self._salt}\0{title}\0{content}".encode("utf-8"))
        return digest.hexdigest()[:32]

    def get(self, key: str) -> Optional[dict]:
        with self._lock:
            entry = self._data.get(key)
            return dict(entry) if isinstance(entry, dict) else None

    def put(self, key: str, title: str, summary: str, input_tokens: int, output_tokens: int) -> None:
        with self._lock:
            self._data[key] = {
                "title": title,
                "summary": summary,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            }
            self._flush()

    def _flush(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    def __len__(self) -> int:
        return len(self._data)

    def clear(self) -> None:
        with self._lock:
            self._data = {}
            try:
                self.path.unlink()
            except FileNotFoundError:
                pass
