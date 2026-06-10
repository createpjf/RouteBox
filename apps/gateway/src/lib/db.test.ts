import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";

const TEST_DB = "/tmp/routebox-test-db.sqlite";

// 必须在 import db 之前设置(db.ts 在模块加载时按此路径打开 SQLite)
process.env.ROUTEBOX_DB_KEY = "1".repeat(64);
process.env.ROUTEBOX_DB_PATH = TEST_DB;

const { saveProviderKey, loadProviderKey, loadAllProviderKeys } = await import("./db");

test("provider key is stored encrypted but reads back as plaintext", () => {
  saveProviderKey("OpenAI", "sk-secret-abc123");

  // 读 API 返回明文
  const row = loadProviderKey("OpenAI");
  expect(row?.api_key).toBe("sk-secret-abc123");

  // 直接查底层表,值应为密文(不含明文)
  const raw = new Database(TEST_DB).query(
    "SELECT api_key FROM provider_keys WHERE provider_name = ?",
  ).get("OpenAI") as { api_key: string };
  expect(raw.api_key.startsWith("enc:v1:")).toBe(true);
  expect(raw.api_key).not.toContain("sk-secret-abc123");
});

test("loadAllProviderKeys decrypts every row", () => {
  saveProviderKey("Anthropic", "sk-ant-xyz789");
  const all = loadAllProviderKeys();
  const anth = all.find((k) => k.provider_name === "Anthropic");
  expect(anth?.api_key).toBe("sk-ant-xyz789");
});
