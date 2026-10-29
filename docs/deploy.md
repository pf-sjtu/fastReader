# 部署与本地开发

fastReader 从「纯浏览器 SPA」改成了「Pages Functions + 共享状态」架构：

- **所有配置与状态**（AI 服务商、处理选项、WebDAV、提示词、处理历史、批量队列、Token 用量）保存在 Cloudflare KV，全员共用一份。
- **API Key / WebDAV 密码只存在于服务端**，由 `/api/ai` 与 `/api/dav` 代理在转发时注入；浏览器只拿得到 `{ hasSecret: true }`。
- **访问控制**：共享密码登录，密码来自环境变量 `APP_PASSWORD`（缺省 `123456a`），会话 Cookie 有效期 30 天。

> 只跑 `pnpm dev`（纯 vite）已经不能工作：`/api/*` 全部由 Pages Functions 提供。

## 1. 首次部署

### 1.1 创建 KV namespace

```bash
# Windows ARM64 下 wrangler 走 x64 仿真，能正常用
pnpm dlx wrangler kv namespace create FASTREADER_KV
```

把输出里的 `id` 填进 `wrangler.toml` 的 `kv_namespaces`：

```toml
kv_namespaces = [
  { binding = "FASTREADER_KV", id = "<上一步的 id>" }
]
```

### 1.2 配置环境变量

Cloudflare Dashboard → **Workers & Pages** → 项目 → **Settings** → **Variables and Secrets**：

| 变量 | 必填 | 说明 |
|------|------|------|
| `APP_PASSWORD` | **必填** | 共享登录密码。正式环境留空时 `/api/auth/login` 直接返回 503（`password_not_configured`）——只在 `localhost`/`127.0.0.1`/`*.local` 这类本机开发环境才允许回落到缺省 `123456a` |
| `SESSION_SECRET` | 可选 | 会话签名密钥。留空时由 `APP_PASSWORD` 派生 |
| `ALLOWED_ORIGINS` | 可选 | 额外的 CORS 白名单，逗号分隔（默认已含 `fast-read.pages.dev`、`read-app.navira.blog`、本机开发端口） |

**改密码 = 让所有已登录浏览器立刻失效**（会话签名里带密码指纹），无需额外操作。

> ⚠️ **密码即管理员**：这是一个单密码共享实例，任何拿到密码的人都能改 AI 服务商、WebDAV 地址与提示词，
> 等价于拿到 WebDAV 的读写权限。请当作内部工具使用，不要把密码发给不可信的人。

### 1.3 部署

```bash
pnpm build:pages          # vite build + chunk 循环依赖检查
pnpm dlx wrangler pages deploy dist
```

CI（`.github/workflows/ci.yml`）会跑 typecheck / lint / test / build / chunk 循环检查，CLI 侧另跑 `pytest`。

## 2. 本地开发

```bash
pnpm build:pages
pnpm dlx wrangler pages dev dist --kv FASTREADER_KV --binding APP_PASSWORD=123456a
```

- `--kv FASTREADER_KV` 会在本地起一个持久化到 `.wrangler/state` 的 KV，不需要真账号。
- 改前端代码时用两个终端：`pnpm build:pages --watch` 之类不方便，推荐直接 `pnpm dlx wrangler pages dev dist --kv FASTREADER_KV` + 需要时手动 build；或者用 `vite build --watch` 配合 `pages dev`。
- 本地默认密码也是 `123456a`；想验证「改密码使会话失效」，重启 dev server 时换 `--binding APP_PASSWORD=xxx`。

## 3. 首次访问（初始化向导）

服务端 KV 为空时，登录后会进入初始化向导，三种方式：

1. **导入配置文件** —— 选一个 `ebook-to-mindmap-config-*.yaml`（1.0.0 或 2.0.0 都支持）。
2. **导入本浏览器旧配置** —— 从 localStorage 读旧数据（拆分前的 `ebook-mindmap-config` 与拆分后的各子键），只在检测到数据时可点。
3. **从空白开始** —— 之后在设置里逐个添加服务商。

导入前会展示预览（新增几个服务商 / 几个模型 / 提示词覆盖项 / WebDAV），确认后才写入服务端。

## 4. 共享状态的写入行为

- 配置写入 **800ms 防抖**，只有数据真的变化才写（KV 免费额度：1000 写/天）。
- 批量队列 **15s 防抖**；Token 用量 **30s 或一本书结束**时合并提交。
- 处理历史 / 用量走 `POST /api/state/:section/append`，服务端合并，多人同时写不丢。
- 窗口重新聚焦 + 每 60s 轮询一次远端（只读）。
- 顶栏图标指示同步状态：已同步 / 同步中 / 冲突 / 离线。冲突时按字段三方合并，同字段双改则远端胜出并提示。

## 5. 已知限制

- **KV 是最终一致的**（异地读最多滞后 60s），且没有 CAS。因此：
  - 乐观锁在跨地域同秒并发时有窗口，可能同字段丢一次改动；
  - 历史 / 用量的 `append` 是「读-合并-写」，两人同时完成一本书极少数情况下会丢一条；
  - 并发新增服务商时，数组按「原子值、远端胜出」合并，可能只保留一边。
  小团队场景可接受；要彻底解决需要 Durable Object。
- **登录失败限速**用「isolate 内内存计数 + KV 兜底」：能挡住常规爆破，但多 isolate 并发仍可能超出阈值。
- **密钥导出**：`导出时包含密钥` 只能导出本次会话里新输入、尚未提交的密钥。服务端已保存的密钥浏览器读不到（这是设计目标），
  导出文件里其余密钥是 `${FASTREADER_...}` 占位符。
- **批量队列租约**靠 30s 心跳续期（页面被浏览器挂起超过 2 分钟才会被他人接管）。
- 免费额度写满（1000 写/天）后写入会失败，界面进入「离线」状态并保留本地改动。
- 服务端无法访问用户本机的 Ollama：`ollama` 类型的服务商走浏览器直连，不经过 `/api/ai`。
- UV 环境：Windows ARM64 上 `uv sync` 需要能编译 `cryptography`；如失败，可用系统 Python 跑 `python -m pytest`（`pyproject.toml` 的依赖不含已移除的 Gemini SDK）。
