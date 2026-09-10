import { resolve } from "node:path";
export function config() {
  const mode = process.env.SHIYU_MODE === "demo" ? "demo" : "live";
  if (mode === "demo" && process.env.NODE_ENV === "production")
    throw new Error("Demo mode is prohibited in production");
  const secret =
    process.env.AUTH_SECRET ||
    (mode === "demo" ? "local-demo-not-a-production-secret-32chars" : "");
  return {
    mode,
    secret,
    dataDir: resolve(
      /* turbopackIgnore: true */ process.env.SHIYU_DATA_DIR || ".data",
    ),
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    moonshotApiKey: process.env.MOONSHOT_API_KEY || "",
    moonshotBaseUrl: (
      process.env.MOONSHOT_BASE_URL || "https://api.moonshot.ai/v1"
    ).replace(/\/$/, ""),
    kimiModel: process.env.KIMI_MODEL || "kimi-k3",
    blobReady: Boolean(
      process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN,
    ),
    origin:
      process.env.APP_ORIGIN ||
      process.env.RENDER_EXTERNAL_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
        : "") ||
      "http://127.0.0.1:3000",
    sessionTtl: 7 * 86400000,
    stepDelay:
      mode === "demo"
        ? Math.max(0, Number(process.env.DEMO_STEP_MS ?? 1000))
        : 0,
    stageTimeout: mode === "demo" ? 30000 : 240000,
    leaseDuration: mode === "demo" ? 60000 : 280000,
  } as const;
}
