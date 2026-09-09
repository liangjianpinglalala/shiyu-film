export const staticSite = process.env.NEXT_PUBLIC_STATIC_SITE === "1";
export function assetPath(path: string) {
  return (process.env.NEXT_PUBLIC_BASE_PATH || "") + path;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  key?: string,
): Promise<T> {
  if (staticSite) {
    if (method === "GET" && path === "capabilities")
      return {
        mode: "live",
        smsReady: false,
        generationReady: false,
        message:
          "公开展示版：可查看页面和示例动画。手机号登录、个人作品和 AI 成片需接入后台服务。",
      } as T;
    if (method === "GET" && path === "auth/me") return { user: null } as T;
    throw new ApiError(503, "公开展示版暂不支持此功能，请先查看示例动画。");
  }
  const response = await fetch(assetPath("/api/" + path), {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      result.error?.message || "请求失败，请稍后重试",
    );
  return result;
}
