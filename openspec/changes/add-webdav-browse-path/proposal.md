# Change: 新增 WebDAV browsePath 以默认浏览根目录

## Why
当前 WebDAV 默认浏览目录与输出目录共用 syncPath，导致默认打开 fastReader 而无法直接浏览根目录其他文件夹。

## What Changes
- 新增 `browsePath` 字段用于浏览目录，默认 `/`
- `syncPath` 仍用于输出目录（默认 `/fastReader`）
- WebDAV 浏览入口改用 `browsePath`
- 更新设置 UI 与文档说明

## Impact
- Affected specs: cloud-cache, batch-ui
- Affected code: src/stores/configStore.ts, src/services/webdavService.ts, src/components/project/WebDAVConfig.tsx, md_reader/src/stores/webdavStore.ts, md_reader/src/services/webdavService.ts, md_reader/src/components/webdav-config.tsx
