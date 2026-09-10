import { NextResponse } from "next/server";
import {
  route,
  body,
  authenticated,
  network,
  COOKIE,
  cookieOptions,
} from "../../../lib/server/http";
import { AuthService, limit } from "../../../lib/server/auth";
import { JobService, jobSchema, present, processOne } from "../../../lib/server/jobs";
import { capabilities } from "../../../lib/server/providers";
import { AppError } from "../../../lib/server/errors";
import { database } from "../../../lib/server/db";
import { KimiScriptProvider } from "../../../lib/server/kimi-script";
import { randomUUID } from "node:crypto";
import { VercelBlobStore } from "../../../lib/server/artifact-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const handler = route(async (request) => {
  const path = request.nextUrl.pathname.replace(/^\/api\//, "");
  const method = request.method;
  if (path === "capabilities" && method === "GET")
    return NextResponse.json(capabilities());
  const auth = new AuthService();
  if (path === "health" && method === "GET") {
    await (
      await import("../../../lib/server/db")
    )
      .database()
      .transaction((q) => q("SELECT 1"));
    return NextResponse.json({ ok: true });
  }
  if (
    (path === "auth/register" || path === "auth/login") &&
    method === "POST"
  ) {
    const b = await body(request);
    const session = await auth[path === "auth/register" ? "register" : "login"](
      typeof b?.username === "string" ? b.username : "",
      typeof b?.password === "string" ? b.password : "",
      network(request),
    );
    const response = NextResponse.json({ user: session.user });
    response.cookies.set(COOKIE, session.token, cookieOptions());
    return response;
  }
  if (path === "auth/me" && method === "GET") {
    const user = await auth.session(request.cookies.get(COOKIE)?.value || "");
    return NextResponse.json({ user });
  }
  if (path === "auth/logout" && method === "POST") {
    await auth.logout(request.cookies.get(COOKIE)?.value || "");
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    return response;
  }
  if (path.startsWith("auth/"))
    throw new AppError(404, "NOT_FOUND", "接口不存在");
  const user = await authenticated(request);
  if (path === "scripts" && method === "POST") {
    const parsed = jobSchema.safeParse(await body(request));
    if (!parsed.success)
      throw new AppError(400, "INVALID_JOB", "请输入有效题目并选择支持的制作设置");
    await database().transaction((q) =>
      limit(q, "daily-scripts:" + user.id, 5, 86400000, Date.now()),
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);
    try {
      const script = await new KimiScriptProvider().create(parsed.data, {
        signal: controller.signal,
        idempotencyKey: request.headers.get("idempotency-key") || randomUUID(),
        maxCostMinorUnits: 100,
      });
      return NextResponse.json({ script });
    } finally {
      clearTimeout(timeout);
    }
  }
  const jobs = new JobService();
  if (path === "jobs" && method === "GET")
    return NextResponse.json({ jobs: await jobs.list(user.id) });
  if (path === "jobs" && method === "POST") {
    const job = await jobs.create(
      user.id,
      await body(request),
      request.headers.get("idempotency-key") || "",
    );
    return NextResponse.json({ job }, { status: 202 });
  }
  const match = /^jobs\/([a-f0-9-]{36})(?:\/(download|retry|process))?$/.exec(path);
  if (match) {
    const [, id, action] = match;
    if (action === "process" && method === "POST") {
      await jobs.get(user.id, id);
      await processOne(jobs, undefined, id, 1);
      return NextResponse.json({ ok: true });
    }
    if (action === "retry" && method === "POST") {
      await jobs.retry(user.id, id);
      return NextResponse.json({ ok: true });
    }
    if (!action && method === "DELETE") {
      await jobs.remove(user.id, id);
      return NextResponse.json({ ok: true });
    }
    if (method === "GET") {
      const job = await jobs.get(user.id, id);
      if (action === "download") {
        if (job.status !== "completed")
          throw new AppError(409, "NOT_READY", "作品尚未完成");
        if (job.mode !== "demo") {
          const result = job.result ? JSON.parse(job.result) : null;
          const key = result?.data?.video?.assetKey;
          if (typeof key !== "string")
            throw new AppError(503, "ASSET_NOT_READY", "成片文件尚未就绪");
          const asset = await new VercelBlobStore().read(key);
          return new Response(asset.data, {
            headers: {
              "Content-Type": "video/mp4",
              "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(JSON.parse(job.input).title + ".mp4")}`,
            },
          });
        }
        const input = JSON.parse(job.input);
        const text = `诗语映画 · 服务端演示说明\n题目：${input.title}\n画面比例：${input.ratio}\n适合：${input.age}\n任务编号：${job.id}\n\n已通过服务端队列完成演示流程。尚未调用 AI 生成脚本或 MP4。`;
        return new Response(text, {
          headers: {
            "Content-Type": "text/plain;charset=utf-8",
            "Content-Disposition": `attachment; filename="demo.txt"; filename*=UTF-8''${encodeURIComponent(input.title + "-演示说明.txt")}`,
          },
        });
      }
      return NextResponse.json({ job: present(job) });
    }
  }
  throw new AppError(404, "NOT_FOUND", "接口不存在");
});
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
