const env: Record<string, string | undefined> = process.env;
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
process.env.SHIYU_MODE = "demo";
process.env.DEMO_STEP_MS = "0";
const input = {
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
