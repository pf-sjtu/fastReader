"""CLI 侧的「模型参数怪癖」后端存档：与浏览器共用 Pages Functions 的 state:modelQuirks。

可选：设置 FASTREADER_SERVER_URL（部署地址，如 https://fast-read.pages.dev）与 FASTREADER_APP_PASSWORD
后，CLI 启动时登录并读取已验证的怪癖（服务商真实输出上限 / 参数名 / 不支持温度 / 不支持思考），
运行中学到并验证成功的新值经 append 接口上报（服务端单调合并）。未设置则只在本批次内存里生效。

键格式与前端 learnedParamsKey 一致：`{providerId 或 apiUrl}|{model}`。
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from typing import Optional

TOKEN_PARAM_RANK = {"max_tokens": 0, "max_completion_tokens": 1, None: 2}


def quirk_key(provider_id: str, api_url: str, model: str) -> str:
    return f"{provider_id or api_url or ''}|{model}"


def merge_quirk(prev: dict, patch: dict) -> dict:
    """单调合并（与前端 mergeLearned / 服务端 mergeQuirks 同规则）"""
    nxt = dict(prev)
    cap = patch.get("outputCap")
    if isinstance(cap, (int, float)) and not isinstance(cap, bool) and cap > 0:
        nxt["outputCap"] = min(int(prev["outputCap"]), int(cap)) if prev.get("outputCap") else int(cap)
    if "tokenParam" in patch and patch["tokenParam"] in TOKEN_PARAM_RANK:
        prev_rank = TOKEN_PARAM_RANK.get(prev.get("tokenParam"), -1) if "tokenParam" in prev else -1
        if TOKEN_PARAM_RANK[patch["tokenParam"]] > prev_rank:
            nxt["tokenParam"] = patch["tokenParam"]
    if patch.get("noTemperature") is True:
        nxt["noTemperature"] = True
    if patch.get("noReasoning") is True:
        nxt["noReasoning"] = True
    return nxt


class QuirkStore:
    """本批次的怪癖表；配置了后端时启动拉取、学到时上报"""

    def __init__(self, server_url: str = "", password: str = "", logger=None, timeout: float = 15.0):
        self.server_url = (server_url or "").rstrip("/")
        self.password = password or ""
        self.logger = logger
        self.timeout = timeout
        self.entries: dict[str, dict] = {}
        self._opener = None

    @classmethod
    def from_env(cls, logger=None) -> "QuirkStore":
        return cls(os.environ.get("FASTREADER_SERVER_URL", ""), os.environ.get("FASTREADER_APP_PASSWORD", ""), logger)

    @property
    def enabled(self) -> bool:
        return bool(self.server_url and self.password)

    def _warn(self, msg: str) -> None:
        if self.logger:
            self.logger.warning(msg)

    def _request(self, method: str, path: str, body: Optional[dict] = None):
        if self._opener is None:
            self._opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
            self._call("POST", "/api/auth/login", {"password": self.password})
        return self._call(method, path, body)

    def _call(self, method: str, path: str, body: Optional[dict]):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.server_url + path, data=data, method=method,
            # 服务端校验 Origin 白名单：同源即可
            headers={"Content-Type": "application/json", "Origin": self.server_url, "User-Agent": "juhua-cli"},
        )
        with self._opener.open(req, timeout=self.timeout) as resp:
            return json.loads(resp.read() or b"{}")

    def load(self) -> int:
        """启动时拉取后端存档；失败只告警（存档是锦上添花，不阻断批处理）"""
        if not self.enabled:
            return 0
        try:
            data = self._request("GET", "/api/state/modelQuirks")
            entries = ((data.get("value") or {}).get("data") or {}).get("entries") or {}
            for key, value in entries.items():
                if isinstance(value, dict):
                    self.entries[key] = merge_quirk(self.entries.get(key, {}), value)
            return len(entries)
        except (urllib.error.URLError, OSError, ValueError) as e:
            self._warn(f"读取后端模型参数存档失败，仅本批次学习: {e}")
            return 0

    def get(self, key: str) -> dict:
        return self.entries.get(key, {})

    def remember(self, key: str, patch: dict) -> None:
        """记住一条已验证的经验；有变化且配置了后端则上报"""
        prev = self.entries.get(key, {})
        nxt = merge_quirk(prev, patch)
        if nxt == prev:
            return
        self.entries[key] = nxt
        if not self.enabled:
            return
        try:
            self._request("POST", "/api/state/modelQuirks/append", {"patch": {"entries": {key: patch}}})
        except (urllib.error.URLError, OSError, ValueError) as e:
            self._warn(f"上报模型参数存档失败（本批次仍生效）: {e}")
