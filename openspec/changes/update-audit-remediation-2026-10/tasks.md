# Tasks

## 0. 工具链（leader）
- [x] 0.1 统一 pnpm：提交 pnpm-lock.yaml、删除 package-lock.json、填写 pnpm-workspace.yaml allowBuilds、packageManager 字段
- [x] 0.2 `tsc -b` 真实类型检查；修正 tsconfig.app/node 路径
- [x] 0.3 vitest / @vitest/ui / @vitest/coverage-v8 锁定 4.0.18
- [x] 0.4 修复 CJS helper 分块，cytoscape 移出首屏
- [x] 0.5 合并 vite 配置为根目录一份；删除无效 configureServer
- [x] 0.6 移除零引用依赖与未使用 shadcn 组件；删除 Vercel 遗留代理
- [x] 0.7 最小 CI
- [ ] 0.8 清零 tsc 错误与 lint error（各领域负责自己的文件）
- [ ] 0.9 移除 Node 专用代理依赖与 alias（待 ai 领域删除调用后）

## 1. 安全（security）
- [ ] 1.1 DAV 代理：同源断言、重定向复检、响应头白名单、请求体上限
- [ ] 1.2 AI 代理：Origin 规则、upstream 校验、同源断言
- [ ] 1.3 IPv6 / 整数 IPv4 字面量拦截
- [ ] 1.4 public/_headers CSP
- [ ] 1.5 sanitizeBookHtml 接入 EpubReader / ViewContentDialog（ui）

## 2. AI 层与解析器（ai）
- [ ] 2.1 AbortSignal 贯穿 provider 与重试 sleep
- [ ] 2.2 mapPoolOrdered 支持 signal 与首错停止
- [ ] 2.3 重试按 status 分类、Retry-After、抖动、provider 冷却
- [ ] 2.4 AI 代理路径拼接修复
- [ ] 2.5 auto 语言跟随界面语言
- [ ] 2.6 后处理只用可用章节；去除重复 system prompt 与 JSON 缩进；截断告警
- [ ] 2.7 PDF worker 用 `?url` 导入；PDF 无目录分组修正；page.cleanup 与 destroy()

## 3. 处理主链路（pipeline）
- [ ] 3.1 换书 / 重启代际作废与 signal 传递
- [ ] 3.2 失败章节 processed:false、isPartial、同步过滤
- [ ] 3.3 批量：mindmap 模式拒绝、章节容错、aiService 局部化、格式判断与选章/截断统一
- [ ] 3.4 清除单章缓存修复；整书导图输入拍平；去重云缓存检查
- [ ] 3.5 云端存在性三态接入；元数据解析器合并与转义
- [ ] 3.6 解析器动态 import

## 4. 存储与状态（storage）
- [ ] 4.1 existsStatus 与按 status 分类重试
- [ ] 4.2 browsePath 只作用于浏览操作
- [ ] 4.3 persist 单一来源、version/migrate、老用户迁移
- [ ] 4.4 批量队列 rehydrate 修复；tokenUsage 不持久化

## 5. UI（ui）
- [ ] 5.1 配置对话框仅打开时预览并可取消
- [ ] 5.2 i18n 缺键补齐与键一致性测试
- [ ] 5.3 EpubReader 字号不重建、切章取消
- [ ] 5.4 处理中返回/中止二次确认；服务商编辑未保存确认
- [ ] 5.5 selector 订阅、memo、稳定回调
- [ ] 5.6 mind-elixir destroy 与懒挂载；局部 ErrorBoundary 与 chunk 失败提示
- [ ] 5.7 BatchQueuePanel 循环修复；可访问性；批量选章
- [ ] 5.8 删除零引用组件

## 6. CLI（cli）
- [ ] 6.1 pyproject 与可在本机直接运行的 pytest
- [ ] 6.2 文件名 / Markdown / 元数据契约对齐，跨端样例
- [ ] 6.3 isPartial 与失败阈值
- [ ] 6.4 共享前端 prompt YAML；后处理喂章节摘要
- [ ] 6.5 PDF 切章、EPUB spine 顺序、跳过词表
- [ ] 6.6 费用/元数据修正
- [ ] 6.7 分类重试、超时、非 TTY、配置边界、Windows 路径、断点续跑

## 7. 收尾（leader）
- [ ] 7.1 补齐各领域上报的 i18n key
- [ ] 7.2 全量 typecheck / lint / test / coverage / build
- [ ] 7.3 更新 README、CLAUDE.md、docs
