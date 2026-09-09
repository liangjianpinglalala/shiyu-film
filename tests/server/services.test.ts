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
  const auth = new AuthService(db, undefined, clock);
  const jobs = new JobService(db, clock);
  await auth.send("13800138000", "test");
  const session = await auth.verify("13800138000", "123456", "test");
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
test("OTP is one use; sessions survive reconnect, expire, and revoke", async () => {
  const s = await setup();
  try {
    await assert.rejects(
      s.auth.verify("13800138000", "123456", "test"),
      errorCode("OTP_EXPIRED"),
    );
    assert.equal((await s.auth.session(s.session.token))?.phone, "138****8000");
    await s.db.close();
    const reopened = new Database(undefined, s.dir);
    try {
      assert.equal(
        (await new AuthService(reopened).session(s.session.token))?.id,
        s.session.user.id,
      );
    } finally {
      await reopened.close();
    }
  } catch (e) {
    throw e;
  }
});
test("server owns expiry, cooldown and attempt lock, not browser clocks", async () => {
  const s = await setup();
  try {
    s.advance(60001);
    await s.auth.send("13900139000", "test");
    await assert.rejects(
      s.auth.send("13900139000", "test"),
      errorCode("OTP_COOLDOWN"),
    );
    for (let i = 0; i < 5; i++)
      await assert.rejects(
        s.auth.verify("13900139000", "999999", "test"),
        errorCode("OTP_INVALID"),
      );
    await assert.rejects(
      s.auth.verify("13900139000", "123456", "test"),
      errorCode("OTP_LOCKED"),
    );
    s.advance(60001);
    await s.auth.send("13900139000", "test");
    s.advance(300001);
    await assert.rejects(
      s.auth.verify("13900139000", "123456", "test"),
      errorCode("OTP_EXPIRED"),
    );
    await s.auth.logout(s.session.token);
    assert.equal(await s.auth.session(s.session.token), null);
  } finally {
    await s.db.close();
  }
});
test("simultaneous verification cannot reuse one OTP", async () => {
  const s = await setup();
  try {
    await s.auth.send("13900139000", "test");
    const result = await Promise.allSettled([
      s.auth.verify("13900139000", "123456", "test"),
      s.auth.verify("13900139000", "123456", "test"),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    await s.db.close();
  }
});
test("failed SMS delivery never creates a usable code", async () => {
  const s = await setup();
  try {
    const failing = new AuthService(s.db, {
      async sendCode() {
        throw new Error("provider failed");
      },
    });
    await assert.rejects(failing.send("13900139000", "test"));
    await assert.rejects(
      s.auth.verify("13900139000", "123456", "test"),
      errorCode("OTP_EXPIRED"),
    );
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
    assert.equal(capabilities().smsReady, false);
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
