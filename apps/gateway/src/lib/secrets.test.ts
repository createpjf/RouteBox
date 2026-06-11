import { test, expect, beforeEach } from "bun:test";

const KEY_HEX = "0".repeat(64); // 32 字节全零,仅测试用

beforeEach(() => {
  process.env.ROUTEBOX_DB_KEY = KEY_HEX;
});

test("encrypt then decrypt round-trips", async () => {
  const { encryptSecret, decryptSecret } = await import("./secrets");
  const plain = "sk-test-1234567890";
  const enc = encryptSecret(plain);
  expect(enc.startsWith("enc:v1:")).toBe(true);
  expect(enc).not.toContain(plain);
  expect(decryptSecret(enc)).toBe(plain);
});

test("decrypt passes through legacy plaintext", async () => {
  const { decryptSecret } = await import("./secrets");
  expect(decryptSecret("sk-legacy-plaintext")).toBe("sk-legacy-plaintext");
});

test("encrypt is non-deterministic (random IV)", async () => {
  const { encryptSecret } = await import("./secrets");
  expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
});

test("without key, encrypt is a passthrough (dev fallback)", async () => {
  delete process.env.ROUTEBOX_DB_KEY;
  const { encryptSecret } = await import("./secrets");
  expect(encryptSecret("plain")).toBe("plain");
});
