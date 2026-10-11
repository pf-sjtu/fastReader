"""真实 InfiniCLOUD 行为：目录无尾斜杠返回 301，缺省 Depth 返回 403。exists 必须能正确处理，而不是连接失败。"""
import httpx
from webdav4.client import Client

from src.cli.webdav_client import _patch_propfind_defaults

MULTISTATUS = """<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/box/cli/</d:href><d:propstat>
<d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status>
</d:propstat></d:response></d:multistatus>"""


def _handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if request.method == "PROPFIND" and "Depth" not in request.headers and path.endswith("/"):
        return httpx.Response(403)  # 缺省 Depth=infinity 被服务器拒绝
    if path == "/dav/box/cli":  # 无尾斜杠 → 301
        return httpx.Response(301, headers={"Location": "https://dav.example.com/dav/box/cli/"})
    if path == "/dav/box/cli/":
        return httpx.Response(207, content=MULTISTATUS, headers={"Content-Type": "application/xml"})
    return httpx.Response(404)


def _client() -> Client:
    http = httpx.Client(transport=httpx.MockTransport(_handler), follow_redirects=True)
    return Client("https://dav.example.com/dav", http_client=http, retry=False)


def test_default_webdav4_fails_on_301_without_patch():
    # 回归基线：不打补丁时确实会因 301 抛错，证明补丁有意义
    try:
        _client().exists("/box/cli")
    except Exception as e:  # noqa: BLE001
        assert "301" in str(e)
    else:
        raise AssertionError("预期 301 抛错")


def test_exists_follows_redirect_after_patch():
    c = _client()
    _patch_propfind_defaults(c)
    assert c.exists("/box/cli") is True
    assert c.exists("/box/missing") is False
