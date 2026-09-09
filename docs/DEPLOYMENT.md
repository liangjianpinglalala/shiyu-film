# 正式后台部署

状态：部署文件已准备，尚未开通云主机或部署公网后台。GitHub Pages 仍为静态展示版。

需要一台能运行 Docker Compose 的 Linux 云主机、指向它的域名，以及开放的 80/443 端口。不要把 PostgreSQL、Redis 或应用 3000 端口暴露公网。GitHub 保存代码和运行检查，不能代替后台主机。

1. 在云主机克隆 GitHub 仓库，安装 Docker Engine 与 Compose。
2. 在项目目录创建私有 `.env`（已经被 Git 忽略），设置以下变量：

```dotenv
SITE_HOST=你的域名
APP_ORIGIN=https://你的域名
AUTH_SECRET=至少32字符的随机密钥
POSTGRES_PASSWORD=随机十六进制密码
```

分别使用 `openssl rand -hex 32` 生成两个不同的随机值。不要把真实值写入本文件或提交仓库。

3. 运行 `docker compose config --quiet` 校验配置，然后运行 `docker compose up -d --build`。
4. Caddy 会在域名解析正确、端口可达时申请 HTTPS 证书。访问域名，检查 `/api/health` 返回 `{"ok":true}`。
5. 注册一个新账号，退出后重新登录，检查刷新后会话恢复。确认旧短信接口返回 404、未登录访问 `/api/jobs` 返回 401。

网站、数据库、Redis 和 Worker 会自动重启；数据保存在 Docker 卷中。更新代码后重新运行部署命令。不要运行 `docker compose down -v`，它会删除数据。正式启用前设置 PostgreSQL 定期备份，并验证恢复流程。

本机未安装 Docker，Compose 尚未在真实 Linux 主机上验证。当前认证支持 SQLite 与 PostgreSQL，迁移只新增 accounts 表，保留旧用户作品；旧手机账号不能自动转为新密码账号。暂不支持自助找回密码。

默认 TRUST_PROXY=false，网络限流使用共享保守额度；只在验证所有请求均经可信反向代理且伪造转发头被覆盖后开启按 IP 限流。

AI 适配器未实现，生产模式不会启动虚假的成片任务。接入供应商、对象存储与 FFmpeg 后才能开放真实制作。正式网站应使用此后台域名，GitHub Pages 可继续作为展示入口。
