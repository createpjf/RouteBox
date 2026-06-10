import { test, expect } from "bun:test";

// 在导入被测模块前设置一个固定 token,使 resolveToken 走 env 分支。
// 使用动态 import,确保该赋值在 auth.ts 顶层求值(捕获 ROUTEBOX_TOKEN)之前生效,
// 覆盖 test-preload.ts 里设置的默认值。
process.env.ROUTEBOX_TOKEN = "rb_testtoken_constant_time";

const { verifyToken } = await import("./auth");

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
