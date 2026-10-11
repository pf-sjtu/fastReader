# Change: CLI WebDAV 探测不得把失败当成不存在

## Why

CLI `file_exists` / `get_file_info`（以及批处理实际走的 `list_files` / `list_cache_files`）把所有异常都当成「文件不存在 / 列表为空」。网络错误、超时、5xx、鉴权失败会让 `skipProcessed` 误判缓存缺失，从而重复处理整书。见 `openspec/changes/fix-silent-failures/proposal.md` 后续建议。

## What Changes

- CLI WebDAV 存在性探测区分三种结果：**存在**、**确实不存在**、**探测失败**
- 404 / 资源不存在：保持原成功语义（`file_exists` → False，`get_file_info` → 空信息）
- 网络错误、超时、5xx、鉴权失败、未连接：抛出可区分异常，不得伪装成不存在
- 批处理加载云端缓存列表时，探测失败则中止，而不是按「无缓存」整书重跑
- 不改前端 TS WebDAV

无对外 API **BREAKING**（CLI 内部从吞异常改为抛错；原先把失败当不存在本身是错误语义）。

## Impact

- Affected specs: `batch-cli`、`cloud-cache`
- Affected code: `src/cli/webdav_client.py`、`src/cli/batch_processor.py`、`tests/python/test_webdav_client.py`
