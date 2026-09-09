import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config";
import { AppError } from "./errors";
import { database, type Database, type Query } from "./db";
const derive = promisify(scrypt);
export function hash(value: string) {
  if (config().secret.length < 32)
    throw new AppError(503, "AUTH_NOT_CONFIGURED", "登录服务尚未完成安全配置");
  return createHmac("sha256", config().secret).update(value).digest("hex");
}
function credentials(username: string, password: string) {
  const name = username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(name))
    throw new AppError(
      400,
      "INVALID_USERNAME",
      "用户名需为 3–32 位字母、数字或下划线，以字母开头",
    );
  if (password.length < 10 || password.length > 128)
    throw new AppError(400, "INVALID_PASSWORD", "密码长度需为 10–128 位");
  return name;
}
async function passwordHash(password: string, salt: string) {
  return (await derive(password, salt, 64)) as Buffer;
}
export async function limit(
  q: Query,
  key: string,
  max: number,
  window: number,
  now: number,
) {
  const [row] = await q<{ count: number; reset_at: number }>(
    "SELECT * FROM limits WHERE key=$1",
    [key],
  );
  if (row && Number(row.reset_at) > now && row.count >= max)
    throw new AppError(429, "RATE_LIMITED", "操作过于频繁，请稍后再试");
  await q(
    "INSERT INTO limits (key,count,reset_at) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET count=$2,reset_at=$3",
    [
      key,
      row && Number(row.reset_at) > now ? row.count + 1 : 1,
      row && Number(row.reset_at) > now ? Number(row.reset_at) : now + window,
    ],
  );
}
export class AuthService {
  constructor(
    private db: Database = database(),
    private now = () => Date.now(),
  ) {}
  private async throttle(name: string, network: string, action: string) {
    // Commit counters before credential checks so failed attempts cannot roll them back.
    await this.db.transaction(async (q) => {
      await limit(
        q,
        action + ":network:" + hash(network),
        action === "register" ? 30 : 100,
        3600000,
        this.now(),
      );
      await limit(q, action + ":account:" + hash(name), 10, 900000, this.now());
    });
  }
  private async createSession(
    q: Query,
    user: { id: string; username: string },
  ) {
    const token = randomBytes(32).toString("hex");
    await q("DELETE FROM sessions WHERE expires_at<=$1", [this.now()]);
    await q(
      "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)",
      [hash(token), user.id, this.now() + config().sessionTtl],
    );
    return { token, user };
  }
  async register(username: string, password: string, network: string) {
    const name = credentials(username, password);
    await this.throttle(name, network, "register");
    const salt = randomBytes(16).toString("hex");
    const digest = (await passwordHash(password, salt)).toString("hex");
    return this.db.transaction(async (q) => {
      const [existing] = await q(
        "SELECT user_id FROM accounts WHERE username=$1",
        [name],
      );
      if (existing)
        throw new AppError(
          409,
          "USERNAME_TAKEN",
          "用户名已被使用，请选择其他用户名",
        );
      const id = randomUUID();
      // Preserve the legacy users schema and ownership; never turn old phone accounts into password accounts.
      await q("INSERT INTO users (id,phone,created_at) VALUES ($1,$2,$3)", [
        id,
        "account:" + id,
        this.now(),
      ]);
      await q(
        "INSERT INTO accounts (user_id,username,password_hash,salt) VALUES ($1,$2,$3,$4)",
        [id, name, digest, salt],
      );
      return this.createSession(q, { id, username: name });
    });
  }
  async login(username: string, password: string, network: string) {
    const name = credentials(username, password);
    await this.throttle(name, network, "login");
    const account = await this.db.transaction(
      async (q) =>
        (
          await q<{ user_id: string; password_hash: string; salt: string }>(
            "SELECT * FROM accounts WHERE username=$1",
            [name],
          )
        )[0],
    );
    const digest = await passwordHash(
      password,
      account?.salt || "00000000000000000000000000000000",
    );
    const expected = Buffer.from(
      account?.password_hash || "00".repeat(64),
      "hex",
    );
    if (!timingSafeEqual(digest, expected) || !account)
      throw new AppError(401, "INVALID_CREDENTIALS", "用户名或密码不正确");
    return this.db.transaction((q) =>
      this.createSession(q, { id: account.user_id, username: name }),
    );
  }
  async session(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.transaction(async (q) => {
      const [user] = await q<{ id: string; username: string }>(
        "SELECT a.user_id AS id,a.username FROM sessions s JOIN accounts a ON a.user_id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2",
        [hash(token), this.now()],
      );
      return user || null;
    });
  }
  async logout(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return;
    await this.db.transaction((q) =>
      q("DELETE FROM sessions WHERE token_hash=$1", [hash(token)]),
    );
  }
}
