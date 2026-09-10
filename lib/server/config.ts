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
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiTextModel: process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna",
    openaiImageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    openaiSpeechModel: process.env.OPENAI_SPEECH_MODEL || "gpt-4o-mini-tts",
    openaiVoice: process.env.OPENAI_VOICE || "coral",
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
  } as const;
}
