# 诗语映画 · 服务端开发版

Next.js + React + TypeScript 国风知识动画网站。账号密码登录、持久任务、Kimi 结构化脚本、Vercel Blob 私有存储和 FFmpeg MP4 渲染已实现。Kimi 不提供图片生成和语音合成 API，因此生产成片入口会保持关闭，直到接入独立的国产画面与配音服务。

## 运行

需要 Node.js 24+ 和 npm。

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:3000 。开发命令会同时启动网站与后台 Worker，默认明确启用 `demo`。无需 PostgreSQL、Redis 或付费账号；服务端数据保存在 `.data/shiyu.sqlite`。关闭浏览器不影响制作，刷新后从服务端恢复状态。停止整个开发进程会暂停处理，重启后会恢复排队任务；被中断的执行最多等待 60 秒租约到期。

使用用户名和密码注册。用户名为 3–32 位字母、数字或下划线，以字母开头（不区分大小写）；密码为 10–128 位。无需手机号，注册后自动登录。密码使用随机盐和 scrypt 哈希保存，不存明文。暂未提供自助找回密码。

## 本轮实现

- HttpOnly / SameSite 会话 cookie，服务端撤销登录，生产 HTTPS Secure cookie。
- 用户名与网络注册/登录限流，错误密码也会消耗额度。
- 任务创建、查询、下载、删除、重试均验证登录和用户归属。
- 服务端验证题目与选项，每个用户最多一个活动任务、每 24 小时最多 20 次提交。
- 幂等提交避免同一请求重复创建；任务的设置独立保存。
- 后台执行 5 个演示步骤，保存检查点、租约和有限重试。支持工作进程崩溃后续跑，旧执行者不能覆盖新租约结果。
- 生产数据库适配 PostgreSQL；配置 REDIS_URL 时 Worker 用 BullMQ 分发，定期根据数据库补投遗漏任务。
- Kimi Chat Completions API 脚本适配器使用严格 JSON Schema、服务端密钥和请求随机数，并校验输出。
- 完整成片服务未就绪时真实模式明确返回未配置，不请求 AI。
- 各制作服务接口见 `lib/server/media-contracts.ts`，流程接口见 `lib/server/providers.ts`。

## 仍未实现的部分

尚无 AI 脚本/图片/配音、字幕对齐、FFmpeg 成片、S3 存储或付款服务。下载是服务端生成的 TXT 演示说明，动态预览仍是预置 SVG 模板。作品归属已由服务器控制，账号认证可以在安全配置完成后用于正式部署。资料核验、生成质量、使用费用与模型调用幂等性需要在真实适配器接入后验证。

后台演示只消耗本地计算，不会发出付费调用。v0.1 浏览器里的旧演示记录不会自动导入。

## 配置与部署

复制 `.env.example` 为 `.env.local` 后按需编辑。开发启动读取该文件。

- `SHIYU_MODE=demo`：只允许非生产环境使用。`NODE_ENV=production` 时拒绝 demo。
- `SHIYU_MODE=live`：账号注册登录可用（需 AUTH_SECRET）；AI 接口尚未配置，会明确拒绝。
- `AUTH_SECRET`：真实模式至少 32 个字符；必须随机生成，不能提交 Git。
- `APP_ORIGIN`：请求允许的完整来源，必须与浏览器地址一致。
- `DATABASE_URL`：配置则用 PostgreSQL，否则本地 SQLite。
- `REDIS_URL`：配置则使用 BullMQ，否则本地数据库持久队列。
- `NEW_MOONSHOT_API_KEY`：仅服务端读取的 Kimi API Key；不得使用 `NEXT_PUBLIC_` 前缀或提交到 Git。旧变量名 `MOONSHOT_API_KEY` 仍兼容。
- `MOONSHOT_BASE_URL`：Kimi API 地址，默认 `https://api.moonshot.ai/v1`。
- `KIMI_MODEL`：脚本模型，默认 `kimi-k3`。
- `BLOB_READ_WRITE_TOKEN`：Vercel Blob 私有存储凭证；同项目连接存储后由平台注入。
- `TRUST_PROXY=true`：仅能在反向代理会覆盖不可信转发头时设置。默认所有请求共享保守网络额度。

`compose.yaml` 提供 PostgreSQL、Redis、网站、Worker 的部署结构，启动前设置 SITE_HOST、APP_ORIGIN、AUTH_SECRET、POSTGRES_PASSWORD（使用随机十六进制密码，避免 URI 特殊字符），内含 Caddy HTTPS 反向代理，部署步骤见 [后台部署](docs/DEPLOYMENT.md)。数据库和 Redis 不开放宿主机端口。该结构尚未在本机实跑：本机没有 Docker、PostgreSQL 或 Redis。生产供应商仍待接入，不能直接对外提供成片服务。

## 验证

```sh
npm run typecheck
npm run build
npm test
```

服务测试：`npm run test:server`。浏览器测试：`npm run test:e2e`，会在 3100 端口启动独立服务、独立 Worker 和隔离数据库，不使用当前预览数据。Windows 默认使用本机 Edge，CI 使用 Playwright Chromium。

测试报告保存到忽略提交的 `test-results`；测试数据库位于 `.data-test-*`，不提交。GitHub Actions 配置会运行构建与测试，已连接 GitHub 远程仓库。

## 工程说明

- 本地数据库采用 Node.js 内置 SQLite，代码共用参数化 SQL。
- PostgreSQL 的关键业务事务使用事务级锁，优先保证首版一致性；高并发时需细分到用户或任务级锁。
- 数据库当前支持初始建表；正式数据迁移和备份策略需在上线前补齐。
- 媒体步骤超时 30 秒，租约 60 秒；未来长时视频供应商必须使用异步轮询和租约续期。
- 第三方副作用的防重复必须由适配器传递幂等键或保存供应商任务 ID，不能仅依靠本地队列。
- Worker 使用编译后的文件，修改后台逻辑后重启 `npm run dev` 使其生效。

源码仓库：https://github.com/liangjianpinglalala/shiyu-film 。完整制作后台仍待部署，GitHub Pages 仅发布下述公开展示版。

## GitHub Pages 公开展示版

访问地址：https://liangjianpinglalala.github.io/shiyu-film/

`main` 的新提交会触发 `Deploy GitHub Pages`：生成静态页面、运行展示版浏览器测试，再发布到 GitHub Pages。只上传 `.pages-build/out` 的构建产物，不上传服务器代码、数据库或环境变量。

GitHub Pages 版本支持首页、手机布局、设置展示和预置动态分镜。页面明确标注公开展示版；注册、登录、作品和 AI 成片入口不提供真实后台操作。此版本不会发送 API 请求，也不会伪造公网登录。

```sh
npm run build:pages
npm run test:pages
```

静态构建在隔离目录 `.pages-build` 内运行，仅复制页面、客户端辅助代码、类型和插画，不修改或删除主项目后台路由。`npm run dev` 仍运行原有服务器演示版。

更换仓库名时，在构建环境设置 `PAGES_BASE_PATH=/新仓库名`，并同步静态测试服务的路径。GitHub Pages 无法运行当前 Node.js Worker、数据库和真实登录，完整制作服务仍需服务器部署。
