"""
统一重试 helper 测试：可重试判定、Retry-After、退避+抖动、次数上限
"""

from email.utils import format_datetime
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest

from src.cli.retry import (
    RetryPolicy,
    call_with_retry,
    get_retry_after,
    get_status_code,
    is_retryable,
)


class StatusError(Exception):
    def __init__(self, status, headers=None, attr="status_code"):
        super().__init__(f"HTTP {status}")
        setattr(self, attr, status)
        self.response = SimpleNamespace(headers=headers or {}, status_code=status)


def flaky(errors, result="ok"):
    """前 len(errors) 次依次抛出 errors，之后返回 result"""
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] <= len(errors):
            raise errors[calls["n"] - 1]
        return result

    return fn, calls


def recording_policy(**kwargs):
    waits = []
    return RetryPolicy(sleep=waits.append, **kwargs), waits


class TestClassification:
    @pytest.mark.parametrize("status", [408, 429, 500, 502, 503, 504])
    def test_retryable_status(self, status):
        assert is_retryable(StatusError(status)) is True

    @pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
    def test_non_retryable_status(self, status):
        assert is_retryable(StatusError(status)) is False

    def test_genai_style_code_attr(self):
        assert get_status_code(StatusError(429, attr="code")) == 429

    def test_status_from_response_only(self):
        exc = Exception("x")
        exc.response = SimpleNamespace(status_code=503, headers={})
        assert get_status_code(exc) == 503

    def test_string_status(self):
        exc = Exception("x")
        exc.status = "503"
        assert get_status_code(exc) == 503

    @pytest.mark.parametrize("exc", [
        TimeoutError(), ConnectionError(), httpx.ReadTimeout("t"), httpx.ConnectError("c"),
        type("APITimeoutError", (Exception,), {})(),
    ])
    def test_network_errors_retryable(self, exc):
        assert is_retryable(exc) is True

    def test_plain_error_not_retryable(self):
        assert is_retryable(ValueError("bad")) is False


class TestRetryAfter:
    def test_seconds(self):
        assert get_retry_after(StatusError(429, {"retry-after": "7"})) == 7.0

    def test_http_date(self):
        when = datetime.now(timezone.utc) + timedelta(seconds=30)
        value = get_retry_after(StatusError(503, {"Retry-After": format_datetime(when, usegmt=True)}))
        assert 25 <= value <= 31

    def test_capped_and_invalid(self):
        assert get_retry_after(StatusError(429, {"retry-after": "99999"})) == 600.0
        assert get_retry_after(StatusError(429, {"retry-after": "soon"})) is None
        assert get_retry_after(StatusError(429)) is None
        assert get_retry_after(ValueError()) is None


class TestCallWithRetry:
    def test_success_after_retries_uses_configured_delays_with_jitter(self):
        policy, waits = recording_policy(max_retries=3, delays=[10, 20])
        fn, calls = flaky([StatusError(503), StatusError(500), StatusError(429)])
        messages = []
        assert call_with_retry(fn, policy, "测试", on_retry=messages.append) == "ok"
        assert calls["n"] == 4
        assert len(waits) == 3
        assert 10 <= waits[0] <= 12 and 20 <= waits[1] <= 24 and 20 <= waits[2] <= 24
        assert "HTTP 503" in messages[0] and "1/3" in messages[0]

    def test_retry_after_takes_precedence(self):
        policy, waits = recording_policy(max_retries=1, delays=[100])
        fn, _ = flaky([StatusError(429, {"retry-after": "3"})])
        call_with_retry(fn, policy)
        assert waits == [3.0]

    def test_auth_error_fails_immediately(self):
        policy, waits = recording_policy(max_retries=5)
        fn, calls = flaky([StatusError(401)])
        with pytest.raises(StatusError):
            call_with_retry(fn, policy)
        assert calls["n"] == 1 and waits == []

    def test_exhausted_raises_last_error(self):
        policy, waits = recording_policy(max_retries=2, delays=[1])
        fn, calls = flaky([StatusError(503)] * 5)
        with pytest.raises(StatusError):
            call_with_retry(fn, policy)
        assert calls["n"] == 3 and len(waits) == 2

    def test_exponential_when_no_delays(self):
        policy = RetryPolicy(delays=[], base_delay=2)
        assert [policy.delay_for(i) for i in range(3)] == [2, 4, 8]

    def test_zero_retries(self):
        policy, waits = recording_policy(max_retries=0)
        fn, calls = flaky([TimeoutError()])
        with pytest.raises(TimeoutError):
            call_with_retry(fn, policy)
        assert calls["n"] == 1
