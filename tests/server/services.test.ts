const env: Record<string, string | undefined> = process.env;
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../lib/server/db";
import { AuthService } from "../../lib/server/auth";
import { JobService, processOne } from "../../lib/server/jobs";
import {
  capabilities,
  generationProvider,
  type GenerationProvider,
} from "../../lib/server/providers";
import { config } from "../../lib/server/config";
import { OpenAIScriptProvider } from "../../lib/server/openai-script";
import type { JobInput } from "../../lib/shared/types";
import {
  OpenAIImageProvider,
  OpenAISpeechProvider,
} from "../../lib/server/media-providers";
import type { ArtifactStore } from "../../lib/server/media-contracts";
import { FfmpegRenderProvider } from "../../lib/server/ffmpeg-render";
import { writeFile } from "node:fs/promises";
process.env.SHIYU_MODE = "demo";
process.env.DEMO_STEP_MS = "0";
const input: JobInput = {
  title: "静夜思",
  kind: "古诗",
  ratio: "16:9 横屏",
  age: "小学阶段",
};
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "shiyu-test-"));
  const db = new Database(undefined, dir);
  let now = Date.now();
  const clock = () => now;
  const auth = new AuthService(db, clock);
  const jobs = new JobService(db, clock);
  const session = await auth.register("tester", "test-password-123", "test");
  return {
    db,
    dir,
    auth,
    jobs,
    session,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
function errorCode(code: string) {
  return (e: unknown) => (e as { code: string }).code === code;
}
test("password sessions survive reconnect, revoke and never store plaintext", async () => {
  const s = await setup();
  const rows = await s.db.transaction((q) =>
    q<{ password_hash: string; salt: string }>("SELECT * FROM accounts"),
  );
  assert.notEqual(rows[0].password_hash, "test-password-123");
  assert.equal(rows[0].password_hash.length, 128);
  await s.db.close();
  const reopened = new Database(undefined, s.dir);
  try {
    const auth = new AuthService(reopened);
    assert.equal((await auth.session(s.session.token))?.username, "tester");
    const login = await auth.login("TESTER", "test-password-123", "test");
    assert.equal(login.user.id, s.session.user.id);
    await auth.logout(login.token);
    assert.equal(await auth.session(login.token), null);
  } finally {
    await reopened.close();
  }
});
test("duplicate registration is atomic and cannot overwrite passwords", async () => {
  const s = await setup();
  try {
    const result = await Promise.allSettled([
      s.auth.register("another", "another-password", "test"),
      s.auth.register("ANOTHER", "different-password", "test"),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    await assert.rejects(
      s.auth.register("tester", "new-password-123", "test"),
      errorCode("USERNAME_TAKEN"),
    );
    assert.ok(await s.auth.login("tester", "test-password-123", "test"));
  } finally {
    await s.db.close();
  }
});
test("invalid credentials are generic and failed logins consume rate limits", async () => {
  const s = await setup();
  try {
    await assert.rejects(
      s.auth.register("x", "test-password-123", "test"),
      errorCode("INVALID_USERNAME"),
    );
    await assert.rejects(
      s.auth.register("valid", "short", "test"),
      errorCode("INVALID_PASSWORD"),
    );
    await assert.rejects(
      s.auth.login("unknown", "wrong-password", "test"),
      errorCode("INVALID_CREDENTIALS"),
    );
    for (let i = 0; i < 10; i++)
      await assert.rejects(
        s.auth.login("tester", "wrong-password", "test"),
        errorCode("INVALID_CREDENTIALS"),
      );
    await assert.rejects(
      s.auth.login("tester", "test-password-123", "test"),
      errorCode("RATE_LIMITED"),
    );
    s.advance(900001);
    assert.ok(await s.auth.login("tester", "test-password-123", "test"));
  } finally {
    await s.db.close();
  }
});
test("ownership, idempotency and immutable job settings", async () => {
  const s = await setup();
  try {
    const a = await s.jobs.create(
      s.session.user.id,
      input,
      "request-1234567890",
    );
    const b = await s.jobs.create(
      s.session.user.id,
      input,
      "request-1234567890",
    );
    assert.equal(a.id, b.id);
    await assert.rejects(
      s.jobs.create(
        s.session.user.id,
        { ...input, title: "咏鹅" },
        "request-1234567890",
      ),
      errorCode("IDEMPOTENCY_CONFLICT"),
    );
    await assert.rejects(
      s.jobs.create(s.session.user.id, input, "request-2222222222"),
      errorCode("JOB_ACTIVE"),
    );
    await assert.rejects(
      s.jobs.get("another-user", a.id),
      errorCode("NOT_FOUND"),
    );
    await assert.rejects(
      s.jobs.remove("another-user", a.id),
      errorCode("NOT_FOUND"),
    );
    await assert.rejects(
      s.jobs.remove(s.session.user.id, a.id),
      errorCode("JOB_ACTIVE"),
    );
    assert.equal(
      (await s.jobs.get(s.session.user.id, a.id)).input,
      JSON.stringify(input),
    );
  } finally {
    await s.db.close();
  }
});
test("completed checkpoints survive worker restart and only missing stages rerun", async () => {
  const s = await setup();
  try {
    const a = await s.jobs.create(
      s.session.user.id,
      input,
      "restart-123456789",
    );
    const called: number[] = [];
    const failing: GenerationProvider = {
      async runStage(p) {
        called.push(p.stage);
        if (p.stage === 2) throw new Error("temporary");
        return { kind: "demo-manifest", data: { stage: p.stage } };
      },
    };
    await processOne(s.jobs, failing);
    assert.equal((await s.jobs.get(s.session.user.id, a.id)).step, 2);
    const successful: GenerationProvider = {
      async runStage(p) {
        called.push(p.stage);
        return { kind: "demo-manifest", data: { stage: p.stage } };
      },
    };
    await processOne(new JobService(s.db), successful);
    const completed = await s.jobs.get(s.session.user.id, a.id);
    assert.equal(completed.status, "completed");
    assert.deepEqual(called, [0, 1, 2, 2, 3, 4]);
    await s.jobs.remove(s.session.user.id, a.id);
    assert.deepEqual(await s.jobs.list(s.session.user.id), []);
  } finally {
    await s.db.close();
  }
});
test("leases prevent duplicate workers and stale completion writes", async () => {
  const s = await setup();
  try {
    const a = await s.jobs.create(
      s.session.user.id,
      input,
      "lease-12345678901",
    );
    const first = await s.jobs.claim(a.id);
    assert.ok(first);
    assert.equal(await s.jobs.claim(a.id), null);
    s.advance(60001);
    const replacement = await s.jobs.claim(a.id);
    assert.ok(replacement);
    assert.notEqual(first.lease_token, replacement.lease_token);
    assert.equal(
      await s.jobs.checkpoint(first, 5, { kind: "demo-manifest", data: {} }),
      false,
    );
  } finally {
    await s.db.close();
  }
});
test("automatic retries are bounded and explicit retry is capped", async () => {
  const s = await setup();
  try {
    const a = await s.jobs.create(
      s.session.user.id,
      input,
      "failure-123456789",
    );
    const fail: GenerationProvider = {
      async runStage() {
        throw Error("unavailable");
      },
    };
    for (let i = 0; i < 3; i++) await processOne(s.jobs, fail);
    assert.equal((await s.jobs.get(s.session.user.id, a.id)).status, "failed");
    for (let i = 0; i < 3; i++) {
      await s.jobs.retry(s.session.user.id, a.id);
      await processOne(s.jobs, fail);
    }
    await assert.rejects(
      s.jobs.retry(s.session.user.id, a.id),
      errorCode("RETRY_UNAVAILABLE"),
    );
  } finally {
    await s.db.close();
  }
});
test("unconfigured live services fail closed and production rejects demo mode", async () => {
  const s = await setup();
  const oldNode = env.NODE_ENV;
  try {
    process.env.SHIYU_MODE = "live";
    process.env.AUTH_SECRET = "test-only-live-key-not-a-real-secret-12345";
    assert.equal(capabilities().authReady, true);
    assert.equal(capabilities().scriptReady, false);
    assert.ok(await s.auth.register("live_user", "live-password-123", "live"));
    assert.equal(capabilities().generationReady, false);
    await assert.rejects(
      s.jobs.create(s.session.user.id, input, "live-123456789012"),
      errorCode("SERVICE_NOT_CONFIGURED"),
    );
    await assert.rejects(
      generationProvider().runStage({
        jobId: "x",
        stage: 0,
        input: input as never,
        previous: null,
        signal: new AbortController().signal,
        idempotencyKey: "x",
      }),
      errorCode("SERVICE_NOT_CONFIGURED"),
    );
    process.env.SHIYU_MODE = "demo";
    env.NODE_ENV = "production";
    assert.throws(() => config(), /prohibited/);
  } finally {
    process.env.SHIYU_MODE = "demo";
    if (oldNode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = oldNode;
    delete process.env.AUTH_SECRET;
    await s.db.close();
  }
});

test("deleting outputs does not reset daily generation quota", async () => {
  const s = await setup();
  try {
    for (let i = 0; i < 20; i++) {
      const w = await s.jobs.create(
        s.session.user.id,
        input,
        "quota-request-" + String(i).padStart(6, "0"),
      );
      await processOne(s.jobs);
      await s.jobs.remove(s.session.user.id, w.id);
    }
    await assert.rejects(
      s.jobs.create(s.session.user.id, input, "quota-over-limit-000"),
      errorCode("RATE_LIMITED"),
    );
    s.advance(86400001);
    assert.ok(
      await s.jobs.create(s.session.user.id, input, "quota-new-window-000"),
    );
  } finally {
    await s.db.close();
  }
});
test("server session expiry and invalid inputs are enforced", async () => {
  const s = await setup();
  try {
    assert.equal(await s.auth.session("fake-session"), null);
    s.advance(7 * 86400000 + 1);
    assert.equal(await s.auth.session(s.session.token), null);
    await assert.rejects(
      s.jobs.create(
        s.session.user.id,
        { ...input, owner: "forged" },
        "invalid-input-12345",
      ),
      errorCode("INVALID_JOB"),
    );
    await assert.rejects(
      s.jobs.create(s.session.user.id, input, "short"),
      errorCode("INVALID_IDEMPOTENCY_KEY"),
    );
  } finally {
    await s.db.close();
  }
});


test("Render origin is server configured and explicit custom domain takes precedence", () => {
  const original = process.env.APP_ORIGIN;
  const render = process.env.RENDER_EXTERNAL_URL;
  try {
    delete process.env.APP_ORIGIN;
    process.env.RENDER_EXTERNAL_URL = "https://shiyu-test.onrender.com";
    assert.equal(config().origin, "https://shiyu-test.onrender.com");
    process.env.APP_ORIGIN = "https://film.example.com";
    assert.equal(config().origin, "https://film.example.com");
    delete process.env.APP_ORIGIN;
    delete process.env.RENDER_EXTERNAL_URL;
    assert.equal(config().origin, "http://127.0.0.1:3000");
  } finally {
    if(original === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = original;
    if(render === undefined) delete process.env.RENDER_EXTERNAL_URL; else process.env.RENDER_EXTERNAL_URL = render;
  }
});


test("Vercel uses configured production origin, never the request host", () => {
  const keys = ["APP_ORIGIN", "RENDER_EXTERNAL_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;
  const saved = keys.map(key => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "shiyu-example.vercel.app";
    assert.equal(config().origin, "https://shiyu-example.vercel.app");
    process.env.APP_ORIGIN = "https://film.example.com";
    assert.equal(config().origin, "https://film.example.com");
  } finally {
    keys.forEach((key, index) => {
      if(saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index];
    });
  }
});
test("serverless processing can advance exactly one durable stage per request", async () => {
  const s = await setup();
  try {
    const job = await s.jobs.create(s.session.user.id, input, "stage-request-12345");
    const calls: number[] = [];
    const provider: GenerationProvider = {
      async runStage({ stage, previous }) {
        calls.push(stage);
        return { kind: "demo-manifest", data: { ...(previous?.data || {}), stage } };
      },
    };
    await processOne(s.jobs, provider, job.id, 1);
    assert.deepEqual(calls, [0]);
    assert.equal((await s.jobs.get(s.session.user.id, job.id)).step, 1);
    await processOne(s.jobs, provider, job.id, 1);
    assert.deepEqual(calls, [0, 1]);
    assert.equal((await s.jobs.get(s.session.user.id, job.id)).step, 2);
  } finally {
    await s.db.close();
  }
});

test("OpenAI script adapter sends a structured, non-stored request and validates output", async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const oldModel = process.env.OPENAI_TEXT_MODEL;
  process.env.OPENAI_API_KEY = "test-key-never-sent-to-a-real-service";
  process.env.OPENAI_TEXT_MODEL = "test-model";
  const script = {
    title: "静夜思",
    author: "李白",
    originalText: "床前明月光，疑是地上霜。",
    explanation: "诗人借月光表达思乡之情。",
    sources: [{ title: "作品资料", url: "https://example.com/poem", excerpt: "静夜思" }],
    scenes: Array.from({ length: 4 }, (_, index) => ({
      id: `scene-${index + 1}`,
      narration: `第${index + 1}幕旁白`,
      visualPrompt: `第${index + 1}幕国风画面`,
      durationSeconds: 8,
    })),
  };
  let requestBody: Record<string, unknown> | undefined;
  let requestHeaders: HeadersInit | undefined;
  const provider = new OpenAIScriptProvider(async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    requestHeaders = init?.headers;
    return new Response(JSON.stringify({ output_text: JSON.stringify(script) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    assert.deepEqual(
      await provider.create(input, {
        signal: new AbortController().signal,
        idempotencyKey: "script-test-123456",
        maxCostMinorUnits: 100,
      }),
      script,
    );
    assert.equal(requestBody?.model, "test-model");
    assert.equal(requestBody?.store, false);
    assert.deepEqual(requestBody?.tools, [{ type: "web_search" }]);
    assert.equal(
      (requestBody?.text as { format: { type: string } }).format.type,
      "json_schema",
    );
    assert.equal(
      (requestHeaders as Record<string, string>)["Idempotency-Key"],
      "script-test-123456",
    );
    assert.equal(capabilities().scriptReady, true);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENAI_TEXT_MODEL;
    else process.env.OPENAI_TEXT_MODEL = oldModel;
  }
});

test("OpenAI script adapter fails closed without credentials or valid output", async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(
      new OpenAIScriptProvider().create(input, {
        signal: new AbortController().signal,
        idempotencyKey: "script-test-absence",
        maxCostMinorUnits: 100,
      }),
      errorCode("SERVICE_NOT_CONFIGURED"),
    );
    process.env.OPENAI_API_KEY = "test-key-never-sent-to-a-real-service";
    await assert.rejects(
      new OpenAIScriptProvider(async () =>
        new Response(JSON.stringify({ output_text: "{}" }), { status: 200 }),
      ).create(input, {
        signal: new AbortController().signal,
        idempotencyKey: "script-test-invalid",
        maxCostMinorUnits: 100,
      }),
      errorCode("SCRIPT_PROVIDER_INVALID"),
    );
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test("OpenAI media adapters store generated image and narration as private artifacts", async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-never-sent-to-a-real-service";
  const saved = new Map<string, { data: Uint8Array; mimeType: string }>();
  const store: ArtifactStore = {
    async put(key, data, mimeType) { saved.set(key, { data, mimeType }); },
    async read(key) { return saved.get(key)!; },
    async remove(key) { saved.delete(key); },
  };
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const mockFetch: typeof fetch = async (value, init) => {
    const url = String(value);
    requests.push({ url, body: JSON.parse(String(init?.body)) });
    if (url.endsWith("/images/generations"))
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("png").toString("base64") }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    return new Response(Buffer.from("mp3"), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  };
  const context = {
    signal: new AbortController().signal,
    idempotencyKey: "media-test-123456",
    maxCostMinorUnits: 100,
  };
  try {
    const image = await new OpenAIImageProvider(store, mockFetch).create(
      { id: "scene-1", narration: "月光洒落", visualPrompt: "月下客舍", durationSeconds: 8 },
      [],
      context,
    );
    const speech = await new OpenAISpeechProvider(store, mockFetch).synthesize("床前明月光", context);
    assert.equal(image.mimeType, "image/png");
    assert.equal(saved.get(image.assetKey)?.mimeType, "image/png");
    assert.equal(saved.get(speech.assetKey)?.mimeType, "audio/mpeg");
    assert.equal(speech.segments[0].text, "床前明月光");
    assert.equal(requests[0].body.output_format, "png");
    assert.equal(requests[1].body.response_format, "mp3");
    assert.equal(requests[1].body.voice, "coral");
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
test("OpenAI media adapter exposes a safe provider error code without response details", async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-never-sent-to-a-real-service";
  const store = {
    async put() {},
    async read() { return { data: new Uint8Array(), mimeType: "image/png" }; },
    async remove() {},
  };
  try {
    await assert.rejects(
      new OpenAIImageProvider(store, async () =>
        new Response(JSON.stringify({ error: { code: "billing_hard_limit_reached", message: "sensitive detail" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
      ).create(
        { id: "one", narration: "旁白", visualPrompt: "月光", durationSeconds: 6 },
        [],
        { signal: new AbortController().signal, idempotencyKey: "error-test", maxCostMinorUnits: 100 },
      ),
      (error: unknown) =>
        (error as Error).message === "AI 画面生成失败（billing_hard_limit_reached）",
    );
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test("FFmpeg renderer builds a ratio-aware captioned MP4 and stores it", async () => {
  const assets = new Map<string, { data: Uint8Array; mimeType: string }>([
    ["one", { data: Buffer.from("image-one"), mimeType: "image/png" }],
    ["two", { data: Buffer.from("image-two"), mimeType: "image/png" }],
    ["voice", { data: Buffer.from("audio"), mimeType: "audio/mpeg" }],
  ]);
  const store: ArtifactStore = {
    async put(key, data, mimeType) { assets.set(key, { data, mimeType }); },
    async read(key) { return assets.get(key)!; },
    async remove(key) { assets.delete(key); },
  };
  let command: string[] = [];
  const renderer = new FfmpegRenderProvider(
    store,
    async (_binary, args) => {
      command = args;
      await writeFile(args.at(-1)!, Buffer.from("mp4"));
    },
    "test-ffmpeg",
  );
  const result = await renderer.render(
    {
      script: {
        title: "静夜思",
        explanation: "思乡",
        sources: [{ title: "source", url: "https://example.com" }],
        scenes: [
          { id: "one", narration: "床前明月光", visualPrompt: "月光", durationSeconds: 6 },
          { id: "two", narration: "低头思故乡", visualPrompt: "故乡", durationSeconds: 7 },
        ],
      },
      imageKeys: ["one", "two"],
      audioKeys: ["voice"],
      ratio: "9:16 竖屏",
    },
    { signal: new AbortController().signal, idempotencyKey: "render-test-123", maxCostMinorUnits: 0 },
  );
  assert.equal(result.durationMs, 13000);
  assert.equal(result.mimeType, "video/mp4");
  assert.equal(assets.get(result.assetKey)?.mimeType, "video/mp4");
  assert.match(command.join(" "), /scale=720:1280/);
  assert.match(command.join(" "), /subtitles=/);
  assert.ok(command.includes("libx264"));
});

test("Vercel deployment routes the public project to the Next.js service", () => {
  const deployment = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.deepEqual(deployment.services["shiyu-film"], {
    root: ".",
    framework: "nextjs",
    functions: { "app/api/**/*": { maxDuration: 300 } },
  });
  assert.equal(deployment.rewrites[0].destination.service, "shiyu-film");
});
