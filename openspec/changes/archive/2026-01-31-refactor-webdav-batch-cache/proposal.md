# Change: 批量处理 WebDAV 缓存与调用频率优化

## Why
批量处理链路中存在循环内逐文件调用 WebDAV 的情况，导致请求次数与文件数线性增长，影响性能与稳定性。需要通过单次批处理内缓存云端文件列表来降低请求频率。

## What Changes
- 在前端与 CLI 批量处理流程中引入“单次批处理内缓存 WebDAV 文件列表”的策略
- 批量缓存存在性判断从逐文件远程调用改为本地缓存对比
- 保持最终一致语义，允许短时间内列表不完全最新

## Impact
- Affected specs: batch-ui, batch-cli, cloud-cache
- Affected code: src/services/batchProcessingEngine.ts, src/components/project/BatchProcessingDialog.tsx, src/cli/batch_processor.py, src/cli/webdav_client.py
