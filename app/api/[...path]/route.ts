import { NextResponse } from "next/server";
import {
  route,
  body,
  authenticated,
  network,
  COOKIE,
  cookieOptions,
} from "../../../lib/server/http";
import { AuthService } from "../../../lib/server/auth";
import { JobService, present } from "../../../lib/server/jobs";
import { capabilities } from "../../../lib/server/providers";
import { AppError } from "../../../lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = route(async (request) => {
  const path = request.nextUrl.pathname.replace(/^\/api\//, "");
  const method = request.method;
  if (path === "capabilities" && method === "GET")
    return NextResponse.json(capabilities());
  const auth = new AuthService();
  if (path === "auth/code" && method === "POST") {
    const b = await body(request);
    return NextResponse.json(
      await auth.send(
        typeof b?.phone === "string" ? b.phone : "",
        network(request),
      ),
    );
  }
  if (path === "auth/verify" && method === "POST") {
    const b = await body(request);
    const session = await auth.verify(
      typeof b?.phone === "string" ? b.phone : "",
      typeof b?.code === "string" ? b.code : "",
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
  const user = await authenticated(request);
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
  const match = /^jobs\/([a-f0-9-]{36})(?:\/(download|retry))?$/.exec(path);
  if (match) {
    const [, id, action] = match;
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
        if (job.mode !== "demo")
          throw new AppError(503, "NOT_IMPLEMENTED", "成片存储服务尚未接入");
        const input = JSON.parse(job.input);
        const text = `诗语映画 · 服务端演示说明\n题目：${input.title}\n画面比例：${input.ratio}\n适合：${input.age}\n任务编号：${job.id}\n\n已通过服务端队列完成演示流程。尚未调用 AI 生成脚本、短信或 MP4。`;
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
