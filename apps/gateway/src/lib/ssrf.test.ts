import { test, expect } from "bun:test";
import { assertSafeLocalUrl } from "./ssrf";

test("allows loopback hosts", () => {
  expect(() => assertSafeLocalUrl("http://localhost:11434/v1")).not.toThrow();
  expect(() => assertSafeLocalUrl("http://127.0.0.1:1234/v1")).not.toThrow();
  expect(() => assertSafeLocalUrl("http://[::1]:8080/v1")).not.toThrow();
});

test("allows RFC1918 private ranges", () => {
  expect(() => assertSafeLocalUrl("http://192.168.1.50:11434")).not.toThrow();
  expect(() => assertSafeLocalUrl("http://10.0.0.5:1234")).not.toThrow();
  expect(() => assertSafeLocalUrl("http://172.16.4.4:1234")).not.toThrow();
});

test("rejects cloud metadata address", () => {
  expect(() => assertSafeLocalUrl("http://169.254.169.254/latest/meta-data")).toThrow();
});

test("rejects public hosts", () => {
  expect(() => assertSafeLocalUrl("http://example.com/v1")).toThrow();
  expect(() => assertSafeLocalUrl("https://api.openai.com/v1")).toThrow();
});

test("rejects non-http(s) schemes", () => {
  expect(() => assertSafeLocalUrl("file:///etc/passwd")).toThrow();
  expect(() => assertSafeLocalUrl("gopher://127.0.0.1")).toThrow();
});

test("rejects malformed urls", () => {
  expect(() => assertSafeLocalUrl("not a url")).toThrow();
});
