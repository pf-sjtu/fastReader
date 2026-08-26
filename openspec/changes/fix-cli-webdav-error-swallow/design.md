## Context

`WebDAVClientWrapper.file_exists` / `get_file_info` 用裸 `except Exception: return False/{}`。批处理跳过已处理文件实际走 `list_cache_files` → `list_files`，同样在异常时返回空列表。调用方把空结果当成「没有缓存」。

## Goals / Non-Goals

- Goals: 404 仍表示不存在；网络/鉴权/5xx/超时不得伪装成不存在；批处理探测失败时停止而不是重跑。
- Non-Goals: 不改前端 TS WebDAV；不改 download/upload 的 bool 返回风格；不引入新依赖。

## Decisions

- Decision: 探测失败抛 `WebDAVProbeError`（保留 `__cause__`），404/`ResourceNotFound` 仍返回「不存在」。
  Alternatives considered:
    - 三态返回值（True/False/None 或 Result 对象）——所有调用方都要改判断，比抛错更吵。
    - 继续返回 False 但打日志——调用方仍会当不存在并重跑，解决不了问题。
- Decision: `list_files` / `list_cache_files` 一并改，否则 `skipProcessed` 主路径仍会空列表重跑。
- Decision: 未连接视为探测失败（抛错），不再返回 False / `{}` / `[]`。

## Risks / Trade-offs

- 原先网络抖动时会「当没缓存继续跑」；现在会中止批处理。这是预期，避免重复花钱跑整书。
- `list_files` 对目录 404 仍返回空列表（目录确实不存在 = 没有文件），与单文件 404 语义一致。
