import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { config } from "./config";
export type Query = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;
const schema = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS otp (phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at BIGINT NOT NULL, sent_at BIGINT NOT NULL, attempts INTEGER NOT NULL, ready INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), idempotency_key TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, lease_until BIGINT NOT NULL DEFAULT 0, lease_token TEXT, error TEXT, result TEXT, mode TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, UNIQUE(user_id,idempotency_key))`,
  `CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(status,lease_until)`,
];
export class Database {
  private sqlite?: DatabaseSync;
  private pool?: Pool;
  private tail: Promise<unknown> = Promise.resolve();
  private initialized?: Promise<void>;
  constructor(
    private url?: string,
    private dir = config().dataDir,
  ) {}
  private init() {
    return (this.initialized ??= this.initialize());
  }
  private async initialize() {
    if (this.url) {
      this.pool = new Pool({ connectionString: this.url });
      for (const sql of schema) await this.pool.query(sql);
    } else {
      mkdirSync(this.dir, { recursive: true });
      this.sqlite = new DatabaseSync(join(this.dir, "shiyu.sqlite"));
      this.sqlite.exec(
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
      );
      for (const sql of schema) this.sqlite.exec(sql);
    }
  }
  async transaction<T>(fn: (q: Query) => Promise<T>): Promise<T> {
    await this.init();
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(735192)");
        const result = await fn(
          async <T>(sql: string, p: unknown[] = []) =>
            (await client.query(sql, p)).rows as T[],
        );
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    const run = this.tail.then(async () => {
      const db = this.sqlite!;
      db.exec("BEGIN IMMEDIATE");
      try {
        const q: Query = async <T>(sql: string, p: unknown[] = []) => {
          const params: SQLInputValue[] = [];
          const converted = sql.replace(/\$(\d+)/g, (_, n) => {
            params.push(p[Number(n) - 1] as SQLInputValue);
            return "?";
          });
          return db.prepare(converted).all(...params) as T[];
        };
        const result = await fn(q);
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    });
    this.tail = run.catch(() => {});
    return run;
  }
  async close() {
    await this.tail;
    this.sqlite?.close();
    await this.pool?.end();
  }
}
const globalDb = globalThis as unknown as { shiyuDb?: Database };
export function database() {
  return (globalDb.shiyuDb ??= new Database(config().databaseUrl));
}
