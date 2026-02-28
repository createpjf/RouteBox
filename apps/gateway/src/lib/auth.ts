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

// Print token on startup so the user can configure their clients
console.log(`  ROUTEBOX_TOKEN=${ROUTEBOX_TOKEN}`);

export function verifyToken(token: string): boolean {
  return token === ROUTEBOX_TOKEN;
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
