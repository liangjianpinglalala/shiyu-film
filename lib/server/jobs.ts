import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database, type Database } from "./db";
import { limit } from "./auth";
import { config } from "./config";
import { AppError, unavailable } from "./errors";
import {
  capabilities,
  generationProvider,
  type GenerationProvider,
  type StageResult,
} from "./providers";
import type { Work, JobInput, JobStatus } from "../shared/types";
export const jobSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[\p{L}\p{N}《》·\s-]+$/u),
    kind: z.enum(["自动识别", "古诗", "成语"]),
    ratio: z.enum(["16:9 横屏", "9:16 竖屏"]),
    age: z.enum(["小学阶段", "初中阶段", "全年龄"]),
  })
  .strict();
export type JobRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  input: string;
  status: JobStatus;
  step: number;
  attempts: number;
  lease_until: number;
  lease_token: string | null;
  error: string | null;
  result: string | null;
  mode: "demo" | "live";
  created_at: number;
  updated_at: number;
};
export function present(row: JobRow): Work {
  const input = JSON.parse(row.input) as JobInput;
  return {
    ...input,
    id: row.id,
    date: new Date(Number(row.created_at)).toLocaleDateString("zh-CN"),
    status: row.status,
    step: row.step,
    error: row.error,
    attempts: row.attempts,
    mode: row.mode,
    createdAt: Number(row.created_at),
  };
}
export class JobService {
  constructor(
    private db: Database = database(),
    private now = () => Date.now(),
  ) {}
  async create(userId: string, raw: unknown, key: string) {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_JOB",
        "请输入有效题目并选择支持的制作设置",
      );
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(key))
      throw new AppError(400, "INVALID_IDEMPOTENCY_KEY", "缺少有效的提交编号");
    if (!capabilities().generationReady)
      throw unavailable("AI 制作服务尚未配置，暂时无法创建任务");
    return this.db.transaction(async (q) => {
      const [prior] = await q<JobRow>(
        "SELECT * FROM jobs WHERE user_id=$1 AND idempotency_key=$2",
        [userId, key],
      );
      if (prior) {
        if (prior.input !== JSON.stringify(parsed.data))
          throw new AppError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "该提交编号已用于其他内容",
          );
        return present(prior);
      }
      const [{ count: active }] = await q<{ count: number }>(
        "SELECT COUNT(*) AS count FROM jobs WHERE user_id=$1 AND status IN ('queued','running')",
        [userId],
      );
      if (Number(active) > 0)
        throw new AppError(
          409,
          "JOB_ACTIVE",
          "已有任务正在制作，请先等待其完成",
        );
      await limit(q, "daily-jobs:" + userId, 20, 86400000, this.now());
      const id = randomUUID();
      await q(
        "INSERT INTO jobs (id,user_id,idempotency_key,input,status,step,attempts,lease_until,mode,created_at,updated_at) VALUES ($1,$2,$3,$4,'queued',0,0,0,$5,$6,$6)",
        [
          id,
          userId,
          key,
          JSON.stringify(parsed.data),
          config().mode,
          this.now(),
        ],
      );
      const [row] = await q<JobRow>("SELECT * FROM jobs WHERE id=$1", [id]);
      return present(row);
    });
  }
  async list(userId: string) {
    return this.db.transaction(async (q) =>
      (
        await q<JobRow>(
          "SELECT * FROM jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [userId],
        )
      ).map(present),
    );
  }
  async get(userId: string, id: string) {
    return this.db.transaction(async (q) => {
      const [row] = await q<JobRow>(
        "SELECT * FROM jobs WHERE id=$1 AND user_id=$2",
        [id, userId],
      );
      if (!row) throw new AppError(404, "NOT_FOUND", "作品不存在");
      return row;
    });
  }
  async remove(userId: string, id: string) {
    await this.db.transaction(async (q) => {
      const [row] = await q<JobRow>(
        "SELECT * FROM jobs WHERE id=$1 AND user_id=$2",
        [id, userId],
      );
      if (!row) throw new AppError(404, "NOT_FOUND", "作品不存在");
      if (["queued", "running"].includes(row.status))
        throw new AppError(409, "JOB_ACTIVE", "制作中暂时无法删除");
      await q("DELETE FROM jobs WHERE id=$1 AND user_id=$2", [id, userId]);
    });
  }
  async retry(userId: string, id: string) {
    return this.db.transaction(async (q) => {
      const [row] = await q<JobRow>(
        "SELECT * FROM jobs WHERE id=$1 AND user_id=$2",
        [id, userId],
      );
      if (!row) throw new AppError(404, "NOT_FOUND", "作品不存在");
      if (row.status !== "failed" || row.attempts >= 6)
        throw new AppError(
          409,
          "RETRY_UNAVAILABLE",
          "当前任务无法重试或已达到重试上限",
        );
      const [{ count }] = await q<{ count: number }>(
        "SELECT COUNT(*) AS count FROM jobs WHERE user_id=$1 AND status IN ('queued','running')",
        [userId],
      );
      if (Number(count) > 0)
        throw new AppError(409, "JOB_ACTIVE", "已有任务正在制作");
      await q(
        "UPDATE jobs SET status='queued',error=NULL,lease_until=0,lease_token=NULL,updated_at=$2 WHERE id=$1",
        [id, this.now()],
      );
    });
  }
  async pending() {
    return this.db.transaction((q) =>
      q<JobRow>(
        "SELECT * FROM jobs WHERE status='queued' OR (status='running' AND lease_until<$1) ORDER BY created_at LIMIT 20",
        [this.now()],
      ),
    );
  }
  async claim(id?: string) {
    return this.db.transaction(async (q) => {
      const rows = await q<JobRow>(
        "SELECT * FROM jobs WHERE (status='queued' OR (status='running' AND lease_until<$1))" +
          (id ? " AND id=$2" : "") +
          " ORDER BY created_at LIMIT 1",
        id ? [this.now(), id] : [this.now()],
      );
      const row = rows[0];
      if (!row) return null;
      if (row.attempts >= 6) {
        await q(
          "UPDATE jobs SET status='failed',error='任务达到最大执行次数',lease_token=NULL WHERE id=$1",
          [row.id],
        );
        return null;
      }
      const token = randomUUID();
      await q(
        "UPDATE jobs SET status='running',attempts=attempts+1,lease_until=$2,lease_token=$3,updated_at=$4 WHERE id=$1",
        [row.id, this.now() + 60000, token, this.now()],
      );
      return {
        ...row,
        status: "running" as const,
        attempts: row.attempts + 1,
        lease_token: token,
      };
    });
  }
  async checkpoint(row: JobRow, step: number, result: StageResult) {
    return this.db.transaction(async (q) => {
      const updated = await q<JobRow>(
        "UPDATE jobs SET step=$3,result=$4,status=$5,lease_until=$6,updated_at=$7,error=NULL WHERE id=$1 AND lease_token=$2 RETURNING *",
        [
          row.id,
          row.lease_token,
          step,
          JSON.stringify(result),
          step === 5 ? "completed" : "running",
          step === 5 ? 0 : this.now() + 60000,
          this.now(),
        ],
      );
      return updated.length > 0;
    });
  }
  async fail(row: JobRow, error: unknown) {
    const message =
      error instanceof AppError
        ? error.message
        : "制作服务暂时不可用，系统已保留完成步骤";
    await this.db.transaction((q) =>
      q(
        "UPDATE jobs SET status=$3,error=$4,lease_until=0,lease_token=NULL,updated_at=$5 WHERE id=$1 AND lease_token=$2",
        [
          row.id,
          row.lease_token,
          row.attempts < 3 ? "queued" : "failed",
          message,
          this.now(),
        ],
      ),
    );
  }
}
export async function processOne(
  jobs = new JobService(),
  provider: GenerationProvider = generationProvider(),
  id?: string,
) {
  const row = await jobs.claim(id);
  if (!row) return false;
  try {
    if (row.mode !== config().mode)
      throw new AppError(409, "MODE_MISMATCH", "任务模式与当前服务模式不一致");
    let previous = row.result ? (JSON.parse(row.result) as StageResult) : null;
    for (let stage = row.step; stage < 5; stage++) {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          provider.runStage({
            jobId: row.id,
            stage,
            input: JSON.parse(row.input),
            previous,
            signal: controller.signal,
            idempotencyKey: row.id + "-" + stage,
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new AppError(504, "STAGE_TIMEOUT", "制作步骤超时"));
            }, 30000);
          }),
        ]);
        if (!(await jobs.checkpoint(row, stage + 1, result))) return false;
        previous = result;
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch (e) {
    await jobs.fail(row, e);
  }
  return true;
}
