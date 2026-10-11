## 1. OpenSpec

- [x] 1.1 确认 change-id `fix-cli-webdav-error-swallow` 未被占用
- [x] 1.2 撰写 proposal / design / spec delta，并 `openspec validate fix-cli-webdav-error-swallow --strict`

## 2. CLI WebDAV 探测

- [x] 2.1 `file_exists`：404/不存在 → False；网络/超时/5xx/鉴权/未连接 → `WebDAVProbeError`
- [x] 2.2 `get_file_info`：404/不存在 → 空信息；探测失败 → `WebDAVProbeError`
- [x] 2.3 `list_files` / `list_cache_files` / `check_cache_exists`：探测失败不得返回空当作「没有文件」
- [x] 2.4 `list_books` 不得吞掉 `WebDAVProbeError`

## 3. 调用方

- [x] 3.1 `batch_processor` 加载缓存列表失败时中止批处理并报错，不得按无缓存继续

## 4. 测试

- [x] 4.1 补单测覆盖存在 / 不存在 / 探测失败（含 5xx、网络错误、鉴权）
- [x] 4.2 跑 `python -m pytest tests/python/test_webdav_client.py`
