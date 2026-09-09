import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config";
import { AppError } from "./errors";
import { database, type Database, type Query } from "./db";
import { smsProvider, type SmsProvider } from "./providers";
const phonePattern = /^1[3-9]\d{9}$/;
export function hash(value: string) {
  if (config().secret.length < 32)
    throw new AppError(503, "AUTH_NOT_CONFIGURED", "登录服务尚未完成安全配置");
  return createHmac("sha256", config().secret).update(value).digest("hex");
}
function validatePhone(phone: string) {
  if (!phonePattern.test(phone))
    throw new AppError(
      400,
      "INVALID_PHONE",
      "请输入有效的 11 位中国大陆手机号",
    );
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
    private sms: SmsProvider = smsProvider(),
    private now = () => Date.now(),
  ) {}
  async send(phone: string, network: string) {
    validatePhone(phone);
    const now = this.now();
    const code =
      config().mode === "demo" ? "123456" : String(randomInt(100000, 1000000));
    const codeHash = hash(phone + ":" + code + ":" + now);
    await this.db.transaction(async (q) => {
      const [old] = await q<{ sent_at: number }>(
        "SELECT sent_at FROM otp WHERE phone=$1",
        [phone],
      );
      if (old && now - Number(old.sent_at) < config().otpCooldown)
        throw new AppError(429, "OTP_COOLDOWN", "请等待 60 秒后重新获取验证码");
      await limit(q, "sms:network:" + hash(network), 20, 3600000, now);
      await limit(q, "sms:phone:" + hash(phone), 10, 86400000, now);
      await q(
        "INSERT INTO otp (phone,code_hash,expires_at,sent_at,attempts,ready) VALUES ($1,$2,$3,$4,0,0) ON CONFLICT(phone) DO UPDATE SET code_hash=$2,expires_at=$3,sent_at=$4,attempts=0,ready=0",
        [phone, codeHash, now + config().otpTtl, now],
      );
    });
    try {
      await this.sms.sendCode({
        phone,
        code,
        expiresInSeconds: config().otpTtl / 1000,
        requestId: randomUUID(),
      });
      await this.db.transaction((q) =>
        q("UPDATE otp SET ready=1 WHERE phone=$1 AND code_hash=$2", [
          phone,
          codeHash,
        ]),
      );
    } catch (e) {
      await this.db.transaction((q) =>
        q("DELETE FROM otp WHERE phone=$1 AND code_hash=$2", [phone, codeHash]),
      );
      throw e;
    }
    return { retryAfter: 60, expiresIn: 300, demo: config().mode === "demo" };
  }
  async verify(phone: string, code: string, network: string) {
    validatePhone(phone);
    if (!/^\d{6}$/.test(code))
      throw new AppError(400, "INVALID_CODE", "请输入 6 位验证码");
    const now = this.now();
    const outcome = await this.db.transaction(async (q) => {
      await limit(q, "verify:" + hash(network), 100, 3600000, now);
      const [otp] = await q<{
        code_hash: string;
        expires_at: number;
        sent_at: number;
        attempts: number;
        ready: number;
      }>("SELECT * FROM otp WHERE phone=$1", [phone]);
      if (!otp || !otp.ready || Number(otp.expires_at) <= now)
        return {
          error: new AppError(
            400,
            "OTP_EXPIRED",
            "请先获取有效验证码，验证码可能已过期或已使用",
          ),
        };
      if (otp.attempts >= 5)
        return {
          error: new AppError(
            429,
            "OTP_LOCKED",
            "验证码错误次数过多，请稍后重新获取",
          ),
        };
      const valid = timingSafeEqual(
        Buffer.from(otp.code_hash, "hex"),
        Buffer.from(hash(phone + ":" + code + ":" + otp.sent_at), "hex"),
      );
      if (!valid) {
        await q("UPDATE otp SET attempts=attempts+1 WHERE phone=$1", [phone]);
        return { error: new AppError(400, "OTP_INVALID", "验证码不正确") };
      }
      await q("DELETE FROM otp WHERE phone=$1", [phone]);
      await q(
        "INSERT INTO users (id,phone,created_at) VALUES ($1,$2,$3) ON CONFLICT(phone) DO NOTHING",
        [randomUUID(), phone, now],
      );
      const [user] = await q<{ id: string; phone: string }>(
        "SELECT id,phone FROM users WHERE phone=$1",
        [phone],
      );
      const token = randomBytes(32).toString("hex");
      await q("DELETE FROM sessions WHERE expires_at<=$1", [now]);
      await q(
        "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)",
        [hash(token), user.id, now + config().sessionTtl],
      );
      return {
        token,
        user: {
          id: user.id,
          phone: user.phone.slice(0, 3) + "****" + user.phone.slice(-4),
        },
      };
    });
    if (outcome.error) throw outcome.error;
    return outcome as { token: string; user: { id: string; phone: string } };
  }
  async session(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.transaction(async (q) => {
      const [user] = await q<{ id: string; phone: string }>(
        "SELECT u.id,u.phone FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2",
        [hash(token), this.now()],
      );
      return user
        ? {
            id: user.id,
            phone: user.phone.slice(0, 3) + "****" + user.phone.slice(-4),
          }
        : null;
    });
  }
  async logout(token: string) {
    await this.db.transaction((q) =>
      q("DELETE FROM sessions WHERE token_hash=$1", [hash(token)]),
    );
  }
}
