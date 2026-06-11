import { test, expect, beforeAll } from "bun:test";
import { saveProviderKey, loadProviderKey, loadAllProviderKeys, __rawProviderKeyForTest } from "./db";

// db.ts 的 Database 句柄是模块级单例,其路径由最先导入它的文件决定(可能是 :memory:)。
// 因此本测试不按固定路径另开 DB,而是通过 __rawProviderKeyForTest 读取同一单例底层表的
// 原始值——与 DB 路径及测试导入顺序无关。
// encryptSecret/decryptSecret 在调用时读取 ROUTEBOX_DB_KEY;secrets.test.ts 会在其末个用例
// 删除该变量,故在本文件用例运行前用 beforeAll 重新设置,确保加解密用同一密钥。
beforeAll(() => {
  process.env.ROUTEBOX_DB_KEY = "1".repeat(64);
});

test("provider key is stored encrypted but reads back as plaintext", () => {
  saveProviderKey("OpenAI", "sk-secret-abc123");

  // 读 API 返回明文
  const row = loadProviderKey("OpenAI");
  expect(row?.api_key).toBe("sk-secret-abc123");

  // 底层表中的值应为密文(不含明文)
  const raw = __rawProviderKeyForTest("OpenAI");
  expect(raw?.startsWith("enc:v1:")).toBe(true);
  expect(raw).not.toContain("sk-secret-abc123");
});

test("loadAllProviderKeys decrypts every row", () => {
  saveProviderKey("Anthropic", "sk-ant-xyz789");
  const all = loadAllProviderKeys();
  const anth = all.find((k) => k.provider_name === "Anthropic");
  expect(anth?.api_key).toBe("sk-ant-xyz789");
});
