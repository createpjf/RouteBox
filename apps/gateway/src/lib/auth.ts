import { createMiddleware } from "hono/factory";
import { loadSetting, saveSetting } from "./db";
import crypto from "crypto";

function resolveToken(): string {
  // 1. Environment variable takes priority
  const envToken = process.env.ROUTEBOX_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 2. Try loading from DB (persisted from a previous startup)
  const dbToken = loadSetting("routebox_token");
  if (dbToken) {
    console.log("  Auth token loaded from database.");
    return dbToken;
  }

  // 3. Generate a new random token and persist it
  const newToken = `rb_${crypto.randomBytes(24).toString("hex")}`;
  saveSetting("routebox_token", newToken);
  console.log("  Generated new auth token (saved to database).");
  return newToken;
}

const ROUTEBOX_TOKEN = resolveToken();

// C2a: 不在日志中打印完整 token;只显示掩码前缀供识别
const masked = ROUTEBOX_TOKEN.length > 10
  ? `${ROUTEBOX_TOKEN.slice(0, 6)}…${ROUTEBOX_TOKEN.slice(-4)}`
  : "****";
console.log(`  ROUTEBOX_TOKEN=${masked} (full token in Settings / keychain)`);

export function verifyToken(token: string): boolean {
  // C3: 常量时间比较,避免 token 计时侧信道
  const a = Buffer.from(token);
  const b = Buffer.from(ROUTEBOX_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  const token = header.slice(7);
  if (!verifyToken(token)) {
    return c.json({ error: "Invalid token" }, 401);
  }
  await next();
});
