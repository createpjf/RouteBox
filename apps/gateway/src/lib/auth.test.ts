import { test, expect, beforeAll, afterAll } from "bun:test";
import { verifyToken } from "./auth";

// verifyToken 在调用时读取 ROUTEBOX_TOKEN,故在本文件的测试运行前设置固定 token,
// 运行后恢复默认值(test-preload.ts 中的 "test-token"),避免污染其它测试文件的共享环境。
beforeAll(() => {
  process.env.ROUTEBOX_TOKEN = "rb_testtoken_constant_time";
});
afterAll(() => {
  process.env.ROUTEBOX_TOKEN = "test-token";
});

test("verifyToken accepts the correct token", () => {
  expect(verifyToken("rb_testtoken_constant_time")).toBe(true);
});

test("verifyToken rejects a wrong token of equal length", () => {
  expect(verifyToken("rb_testtoken_constant_XXXX")).toBe(false);
});

test("verifyToken rejects a token of different length without throwing", () => {
  expect(verifyToken("short")).toBe(false);
  expect(verifyToken("")).toBe(false);
});
