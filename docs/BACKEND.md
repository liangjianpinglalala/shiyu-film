# 后台设计与交付边界

## 运行结构

浏览器与 Next.js API 使用同一个 HTTPS 域名。Caddy 处理证书和转发，PostgreSQL 保存账号、会话和作品任务，Redis 分发任务，独立 Worker 处理制作。GitHub 用于保存代码及自动验证；GitHub Pages 保留展示版，不承担账号数据库和后台运行。

## 账号

注册与登录分别调用 /api/auth/register 和 /api/auth/login；成功后服务器设置 HttpOnly、SameSite=Lax、生产 Secure cookie，有效期七天。退出撤销服务器会话。浏览器不保存密码或可伪造的用户身份。用户名全小写唯一，密码使用随机盐与 scrypt 派生。注册并发冲突不会覆盖已有账号；失败登录消耗限流额度。

新增 accounts 表通过 user_id 关联旧 users 表；保留旧用户及作品，旧手机会话不能访问新账号。旧 phone 字段仅为兼容保留，新账号写入内部标识，无需手机号；旧 otp 表不再使用。不提供未验证身份的密码重置。

## 作品与任务

任务只允许创建者查询、删除、下载与重试。提交使用幂等键，每人最多一个活动任务、每日二十次提交。后台持久化排队、执行阶段、检查点和有限重试，网页轮询状态；关闭页面不会取消任务。

## AI 扩展

1. ScriptProvider：已实现 Kimi Chat Completions API 适配器，使用严格 JSON Schema 生成经校验的脚本及分镜。
2. ImageProvider：接口保留，等待接入独立的国产图片生成服务；Kimi 的多模态能力属于输入理解，不生成图片。
3. SpeechProvider：接口保留，等待接入独立的国产语音合成服务；Kimi 不提供语音合成端点。
4. RenderProvider：已实现 FFmpeg 渲染适配器，按横竖屏比例合成画面、普通话配音和烧录字幕，输出 H.264/AAC MP4。
5. ArtifactStore：已实现 Vercel Blob 私有存储；读取仍需经过本站登录与作品归属校验后开放。

适配器接口位于 lib/server/media-contracts.ts，Kimi 脚本适配器位于 lib/server/kimi-script.ts。配置 `MOONSHOT_API_KEY` 后能力接口会报告脚本服务就绪；完整生成入口仍会保持关闭，直到画面和配音供应商完成接入。任务检查点、长阶段租约、私有存储与 FFmpeg 渲染结构可以继续复用。

## 当前完成与后续条件

已完成：账号密码认证、作品权限、持久队列、演示流程、数据库健康接口、同域 HTTPS 部署配置、自动测试。

尚未完成：云平台开通与公网部署、真实 AI 适配器、MP4 合成与存储、自助找回密码、正式备份恢复演练。生产模式不会把演示结果标记为真实成片。选定托管平台和供应商后继续接入，无需重做前端。
