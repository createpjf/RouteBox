// ---------------------------------------------------------------------------
// Shared cryptographic utilities
// ---------------------------------------------------------------------------

import nodeCrypto from "node:crypto";

const PREFIX = "enc:v1:";

/** Compute SHA-256 hash and return as lowercase hex string */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getKey(): Buffer | null {
  const hex = process.env.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM 加密 provider key;无密钥(非生产)时透传明文。 */
export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key) return plain;
  const iv = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

/** 解密;非 `enc:v1:` 前缀视为旧明文直接返回(向后兼容)。 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = getKey();
  if (!key) throw new Error("PROVIDER_KEY_ENCRYPTION_KEY required to decrypt stored secret");
  const body = stored.slice(PREFIX.length);
  const [ivHex, tagHex, ctHex] = body.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
