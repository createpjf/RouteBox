// ---------------------------------------------------------------------------
// Secrets — AES-256-GCM 静态加密(provider key / auth token)
// 主密钥来自 ROUTEBOX_DB_KEY 环境变量(由 Tauri 从 keychain 注入,64 hex = 32 bytes)
// ---------------------------------------------------------------------------

import crypto from "crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const hex = process.env.ROUTEBOX_DB_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

/** 加密;无密钥时(本地 dev)透传明文,保证可用性。 */
export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

/** 解密;非 `enc:v1:` 前缀视为旧明文直接返回(向后兼容)。 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = getKey();
  if (!key) throw new Error("ROUTEBOX_DB_KEY required to decrypt stored secret");
  const body = stored.slice(PREFIX.length);
  const [ivHex, tagHex, ctHex] = body.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
