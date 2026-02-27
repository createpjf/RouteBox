import { createMiddleware } from "hono/factory";

const ROUTEBOX_TOKEN = process.env.ROUTEBOX_TOKEN || "dev-token";

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
