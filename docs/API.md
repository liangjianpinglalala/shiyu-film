# 服务接口 v0.2

所有响应禁止缓存。变更请求必须携带与 APP_ORIGIN 完全一致的 Origin 和 application/json Content-Type。请求体最多 4 KiB。认证使用 HttpOnly cookie，任何接口都不接受客户端提供的用户 ID 作为权限依据。

| 方法   | 路径                   | 说明                                  |
| ------ | ---------------------- | ------------------------------------- |
| GET    | /api/capabilities      | 当前模式、短信与生成可用性            |
| POST   | /api/auth/code         | `{phone}` 获取验证码                  |
| POST   | /api/auth/verify       | `{phone,code}` 验证并写入会话 cookie  |
| GET    | /api/auth/me           | 当前脱敏用户或 null                   |
| POST   | /api/auth/logout       | `{}` 撤销服务端会话与 cookie          |
| POST   | /api/jobs              | 创建任务，需要 Idempotency-Key 请求头 |
| GET    | /api/jobs              | 当前用户最近 100 个任务               |
| GET    | /api/jobs/:id          | 查询本人任务                          |
| GET    | /api/jobs/:id/download | 下载本人已完成作品的演示说明          |
| DELETE | /api/jobs/:id          | `{}` 删除已结束任务                   |
| POST   | /api/jobs/:id/retry    | `{}` 重试失败任务的未完成步骤         |

创建任务：`{title,kind,ratio,age}`。kind：自动识别/古诗/成语；ratio：16:9 横屏/9:16 竖屏；age：小学阶段/初中阶段/全年龄。

任务状态：queued → running → completed；临时错误回到 queued，自动执行达到 3 次后 failed；用户可以显式重试但总执行次数不超过 6。step 为已完成步骤数（0–5），错误结果不伪装成完成。

错误：`{error:{code,message}}`，常见状态码 400（输入错误）、401（未登录）、403（来源错误）、404（不存在或无权访问）、409（任务冲突）、429（限流）、503（服务未配置）。

供应商接入只修改服务器代码。SmsProvider 定义发送协议；ScriptProvider / ImageProvider / SpeechProvider / RenderProvider / ArtifactStore 定义制作与存储协议。接口存在不表示供应商已实现或凭证已经配置。生产 capability 必须在真实适配器、参数校验、权限检查和集成测试完成后才启用。
