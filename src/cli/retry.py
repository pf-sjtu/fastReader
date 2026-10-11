"""
统一重试 helper（AI 与 WebDAV 共用）

规则：
- 只对 408 / 429 / 5xx / 网络错误 / 超时重试
- 400 / 401 / 403 / 404 等其他 4xx 立即失败
- 优先遵守 Retry-After；否则按 retryDelays（缺省指数退避）并叠加抖动
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from typing import Callable, Optional, TypeVar

T = TypeVar("T")

RETRYABLE_STATUS = {408, 429}
# 抖动比例：实际等待 = 基础等待 × (1 + U(0, JITTER_RATIO))
JITTER_RATIO = 0.2
# Retry-After 上限（秒），防止服务端给出离谱值导致长时间挂起
MAX_RETRY_AFTER = 600.0


@dataclass
class RetryPolicy:
    """重试策略：max_retries 为「首次之外」的重试次数"""
    max_retries: int = 3
    delays: list = field(default_factory=lambda: [60, 120, 240, 480])
    base_delay: float = 2.0
    sleep: Optional[Callable[[float], None]] = None  # 缺省 time.sleep（测试可注入）

    def delay_for(self, attempt: int) -> float:
        """第 attempt 次重试（从 0 开始）的基础等待秒数"""
        if self.delays:
            return float(self.delays[min(attempt, len(self.delays) - 1)])
        return self.base_delay * (2 ** attempt)


def get_status_code(exc: BaseException) -> Optional[int]:
    """从各 SDK 异常中提取 HTTP 状态码（openai: status_code；genai: code；webdav4: status_code）"""
    for attr in ("status_code", "code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int) and 100 <= value <= 599:
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    response = getattr(exc, "response", None)
    value = getattr(response, "status_code", None)
    if isinstance(value, int):
        return value
    return None


def _is_network_error(exc: BaseException) -> bool:
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True
    try:
        import httpx
        if isinstance(exc, (httpx.TimeoutException, httpx.TransportError)):
            return True
    except ImportError:  # pragma: no cover - httpx 为传递依赖
        pass
    # openai.APIConnectionError / APITimeoutError 等无状态码的连接类异常
    name = type(exc).__name__
    return name in {"APIConnectionError", "APITimeoutError", "BadGatewayError"}


def is_retryable(exc: BaseException) -> bool:
    """判断异常是否值得重试"""
    status = get_status_code(exc)
    if status is not None:
        return status in RETRYABLE_STATUS or status >= 500
    return _is_network_error(exc)


def get_retry_after(exc: BaseException) -> Optional[float]:
    """读取 Retry-After 头（秒数或 HTTP 日期），无则 None"""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if not headers:
        return None
    try:
        raw = headers.get("retry-after") or headers.get("Retry-After")
    except Exception:
        return None
    if not raw:
        return None
    raw = str(raw).strip()
    try:
        seconds = float(raw)
    except ValueError:
        try:
            when = parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            return None
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        seconds = (when - datetime.now(timezone.utc)).total_seconds()
    return max(0.0, min(seconds, MAX_RETRY_AFTER))


def call_with_retry(
    func: Callable[[], T],
    policy: RetryPolicy,
    operation: str = "操作",
    on_retry: Optional[Callable[[str], None]] = None,
) -> T:
    """执行 func；可重试错误按策略重试，耗尽或不可重试时抛出最后一个异常"""
    attempt = 0
    while True:
        try:
            return func()
        except Exception as exc:
            if attempt >= policy.max_retries or not is_retryable(exc):
                raise
            retry_after = get_retry_after(exc)
            if retry_after is not None:
                wait = retry_after
            else:
                base = policy.delay_for(attempt)
                wait = base * (1 + random.uniform(0, JITTER_RATIO))
            attempt += 1
            if on_retry:
                status = get_status_code(exc)
                tag = f"HTTP {status}" if status else type(exc).__name__
                on_retry(
                    f"{operation} 失败 ({tag})，{wait:.1f}s 后第 {attempt}/{policy.max_retries} 次重试"
                )
            (policy.sleep or time.sleep)(wait)
