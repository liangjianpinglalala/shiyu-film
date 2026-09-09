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
    origin: process.env.APP_ORIGIN || "http://127.0.0.1:3000",
    otpTtl: 300000,
    otpCooldown: 60000,
    sessionTtl: 7 * 86400000,
    stepDelay:
      mode === "demo"
        ? Math.max(0, Number(process.env.DEMO_STEP_MS ?? 1000))
        : 0,
  } as const;
}
