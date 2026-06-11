import { createMiddleware } from "hono/factory";
import { loadSetting, saveSetting } from "./db";
import { encryptSecret, decryptSecret } from "./secrets";
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
    return decryptSecret(dbToken); // C2c: 库内为密文(无密钥时 decrypt 透传旧明文)
  }

  // 3. Generate a new random token and persist it
  const newToken = `rb_${crypto.randomBytes(24).toString("hex")}`;
  saveSetting("routebox_token", encryptSecret(newToken)); // C2c
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
  // 期望值在启动时已解析并记录/持久化(见上)。这里在调用时再读一次
  // ROUTEBOX_TOKEN 环境变量:生产环境该变量在运行期保持不变,故等价于启动值;
  // 测试环境下各测试文件在发起请求前设置 ROUTEBOX_TOKEN,从而不依赖模块加载顺序。
  const expected = process.env.ROUTEBOX_TOKEN || ROUTEBOX_TOKEN;
  // C3: 常量时间比较,避免 token 计时侧信道
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
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
