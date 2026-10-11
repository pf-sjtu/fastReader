# Design: 并行整改的接口契约

六个领域并行修改，按文件所有权隔离；跨领域只通过以下契约耦合：

| 契约 | 提供方 | 约定 |
|---|---|---|
| C1 AI 取消 | ai | `AICallOptions { signal?: AbortSignal }` 作为所有生成方法末尾可选参数，传到 fetch 与重试 sleep；取消抛 `AbortError` |
| C2 并发池 | ai | `mapPoolOrdered` 支持 `signal`；首个 reject 或取消后不再出队，结果仍保序 |
| C3 结果状态 | leader | `src/utils/resultStatus.ts`：统一失败/跳过前缀与 `isUsableText`；失败章节 `processed:false` |
| C4 存在性三态 | storage | `webdavService.existsStatus(path)`：404→missing，2xx/207→exists，鉴权/网络/重试后 5xx→unknown |
| C7 store | storage | 每类持久化数据单一来源；现有导出兼容；订阅方用 selector |
| C8 auto 语言 | ai / cli | 前端跟随 `i18n.language`；CLI 跟随原书语言 |
| C9 HTML 净化 | leader | `sanitizeBookHtml`（DOMPurify），所有书籍/外部 HTML 入 DOM 前必经 |
| C10 文件名 | pipeline 维持 / cli 对齐 | 前端现行规则为准：只去最后一个扩展名（大小写不敏感） |

## 关键取舍

- **CSP 的 connect-src 不收窄到具体主机**：AI 服务商由用户自定义且含本机 Ollama，收窄会直接破坏功能；主要防线是 DOMPurify + `script-src 'self'`（无 `'unsafe-inline'`，即使漏网的事件属性也不会执行）
- **AI 代理不做上游主机白名单**：同上；以 https + 非私网 + 同源路径断言 + Origin 规则约束，配额滥用需在 Cloudflare 侧配置 Rate Limiting
- **章节缓存读取延后到第 2 波**：现有键不含模型/prompt 版本/内容指纹，直接补读取会在换模型后命中旧结果
- **批量 mindmap 先拒绝后支持**：宁可明确报错，也不产出空结果并写入「已处理」
