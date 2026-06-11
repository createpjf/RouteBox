import { test, expect } from "bun:test";
import { resolveAlias } from "./aliases";

test("maps a known alias", () => {
  expect(resolveAlias("claude-haiku", { "claude-haiku": "claude-haiku-4-20250514" }))
    .toBe("claude-haiku-4-20250514");
});
test("passes through unknown model", () => {
  expect(resolveAlias("gpt-4o", { "claude-haiku": "x" })).toBe("gpt-4o");
});
test("empty table is identity (cloud behavior)", () => {
  expect(resolveAlias("anything", {})).toBe("anything");
});
