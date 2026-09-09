import { NextRequest, NextResponse } from "next/server";
import { AuthService } from "./auth";
import { config } from "./config";
import { AppError } from "./errors";
export const COOKIE = "shiyu_session";
export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: config().sessionTtl / 1000,
  };
}
export async function authenticated(request: NextRequest) {
  const user = await new AuthService().session(
    request.cookies.get(COOKIE)?.value || "",
  );
  if (!user)
    throw new AppError(401, "UNAUTHENTICATED", "登录已失效，请重新登录");
  return user;
}
export function network(request: NextRequest) {
  return process.env.TRUST_PROXY === "true"
    ? request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown"
    : "local-untrusted-network";
}
export async function body(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 4096) throw new AppError(413, "TOO_LARGE", "请求内容过大");
  const reader = request.body?.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 4096) {
        await reader.cancel();
        throw new AppError(413, "TOO_LARGE", "请求内容过大");
      }
      chunks.push(value);
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_JSON", "请求格式不正确");
  }
}
export function route(fn: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        const origin = request.headers.get("origin");
        if (origin !== config().origin)
          throw new AppError(403, "ORIGIN_REJECTED", "请求来源不受信任");
        if (
          request.headers.get("content-type")?.split(";")[0] !==
          "application/json"
        )
          throw new AppError(415, "INVALID_CONTENT_TYPE", "请使用 JSON 请求");
      }
      const response = await fn(request);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch (e) {
      const known = e instanceof AppError;
      return NextResponse.json(
        {
          error: {
            code: known ? e.code : "INTERNAL_ERROR",
            message: known ? e.message : "服务暂时不可用，请检查配置或稍后重试",
          },
        },
        {
          status: known ? e.status : 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  };
}
