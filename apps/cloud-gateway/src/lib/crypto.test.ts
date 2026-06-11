import { test, expect, beforeEach } from "bun:test";

const KEY_HEX = "a".repeat(64);

beforeEach(() => {
  process.env.PROVIDER_KEY_ENCRYPTION_KEY = KEY_HEX;
});

test("encrypt then decrypt round-trips", async () => {
  const { encryptSecret, decryptSecret } = await import("./crypto");
  const plain = "sk-cloud-secret-001";
  const enc = encryptSecret(plain);
  expect(enc.startsWith("enc:v1:")).toBe(true);
  expect(enc).not.toContain(plain);
  expect(decryptSecret(enc)).toBe(plain);
});

test("decrypt passes through legacy plaintext", async () => {
  const { decryptSecret } = await import("./crypto");
  expect(decryptSecret("sk-legacy")).toBe("sk-legacy");
});

test("sha256Hex still works", async () => {
  const { sha256Hex } = await import("./crypto");
  expect(await sha256Hex("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
