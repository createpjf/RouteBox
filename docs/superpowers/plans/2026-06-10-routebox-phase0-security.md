# RouteBox Phase 0 — 安全止血 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关闭审计发现的 Critical/High 安全缺口,使本地网关只监听 loopback、停止泄露/明文存储凭据、阻断 SSRF,并对落地存储的 provider key 做静态加密。

**Architecture:** 改动集中在 `apps/gateway`(本地网关)、`apps/cloud-gateway`(云端)、`apps/desktop/src-tauri`(Tauri 宿主)。新增两个小工具模块(网关 `secrets.ts` 做 AES-256-GCM、`ssrf.ts` 做地址白名单),其余为窄改动。加密主密钥:网关从 `ROUTEBOX_DB_KEY` 环境变量读取(由 Tauri 从 keychain 注入),云端从 `PROVIDER_KEY_ENCRYPTION_KEY` 读取。两端的解密对旧的明文值做向后兼容透传,下次写入时自动升级为密文。

**Tech Stack:** TypeScript + Bun(`bun test` 为测试运行器,`*.test.ts` 同目录)、Hono、bun:sqlite、postgres.js、Rust(Tauri 2,`keyring` crate)。

---

## File Structure

| 文件 | 责任 | 操作 |
|------|------|------|
| `apps/gateway/src/index.ts` | 网关入口/监听 | Modify(绑定 127.0.0.1) |
| `apps/gateway/src/lib/auth.ts` | token 解析/校验 | Modify(timingSafeEqual、掩码日志、加密 token) |
| `apps/gateway/src/lib/secrets.ts` | AES-256-GCM 加解密 | Create |
| `apps/gateway/src/lib/secrets.test.ts` | secrets 单测 | Create |
| `apps/gateway/src/lib/ssrf.ts` | 本地地址白名单校验 | Create |
| `apps/gateway/src/lib/ssrf.test.ts` | ssrf 单测 | Create |
| `apps/gateway/src/lib/db.ts` | SQLite provider key 读写 | Modify(读写处加解密) |
| `apps/gateway/src/lib/local-providers.ts` | 本地 provider 探测/转发 | Modify(probe 前做 SSRF 校验、禁重定向) |
| `apps/cloud-gateway/src/index.ts` | 云端入口/CORS | Modify(no-origin 不返回 `*`) |
| `apps/cloud-gateway/src/lib/crypto.ts` | 云端加解密工具 | Modify(新增 AES-256-GCM) |
| `apps/cloud-gateway/src/lib/crypto.test.ts` | 云端 crypto 单测 | Create |
| `apps/cloud-gateway/src/lib/env.ts` | 环境变量校验 | Modify(校验加密密钥) |
| `apps/cloud-gateway/src/lib/provider-config.ts` | provider key CRUD | Modify(读写处加解密) |
| `apps/desktop/src-tauri/src/keychain.rs` | keychain 封装 | Modify(新增 DB key 存取) |
| `apps/desktop/src-tauri/src/commands.rs` | 网关进程启动 | Modify(注入 DB key、丢弃 stdout) |
| `apps/desktop/src-tauri/Entitlements.plist` | macOS 权限 | Modify(注释说明 + 收窄评估) |

**前置说明(执行者必读):**
- 测试运行:`cd apps/gateway && bun test <file>` 或 `cd apps/cloud-gateway && bun test <file>`。
- 加密格式约定(两端一致):密文字符串形如 `enc:v1:<ivHex>:<tagHex>:<ctHex>`,其中 IV 12 字节、GCM tag 16 字节、AES-256-GCM。
- 主密钥为 64 个十六进制字符(= 32 字节)。
- **向后兼容:** 解密遇到不以 `enc:v1:` 开头的值时,视为旧明文直接返回(已有库里的明文 key 不会损坏),下次写入时自动加密。
- 提交前请先 `find . -path ./node_modules -prune -o -name '._*' -delete` 清掉外置盘 AppleDouble 垃圾,避免污染提交。

---

## Task 1: 网关绑定 loopback(C1)

**Files:**
- Modify: `apps/gateway/src/index.ts:127-131`

- [ ] **Step 1: 修改默认导出,显式绑定 127.0.0.1**

将文件末尾的默认导出:

```ts
export default {
  port,
  fetch: app.fetch,
  websocket,
};
```

改为:

```ts
export default {
  port,
  hostname: "127.0.0.1", // C1: 仅监听 loopback,禁止局域网访问本地代理
  fetch: app.fetch,
  websocket,
};
```

- [ ] **Step 2: 手动验证仅监听 loopback**

Run:
```bash
cd apps/gateway && (ROUTEBOX_TOKEN=test bun run src/index.ts &) ; sleep 2 ; \
  lsof -nP -iTCP:3001 -sTCP:LISTEN ; \
  pkill -f "bun run src/index.ts"
```
Expected: LISTEN 行地址为 `127.0.0.1:3001`(而非 `*:3001` 或 `0.0.0.0:3001`)。

- [ ] **Step 3: Commit**

```bash
git add apps/gateway/src/index.ts
git commit -m "fix(gateway): bind to 127.0.0.1 to prevent LAN exposure (C1)"
```

---

## Task 2: token 常量时间比较(C3)

**Files:**
- Modify: `apps/gateway/src/lib/auth.ts:31-33`
- Test: `apps/gateway/src/lib/auth.test.ts` (Create)

- [ ] **Step 1: 写失败测试**

Create `apps/gateway/src/lib/auth.test.ts`:

```ts
import { test, expect } from "bun:test";

// 在导入被测模块前设置一个固定 token,使 resolveToken 走 env 分支
process.env.ROUTEBOX_TOKEN = "rb_testtoken_constant_time";

import { verifyToken } from "./auth";

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/gateway && bun test src/lib/auth.test.ts`
Expected: 当前 `verifyToken` 用 `===` 也会让前两条通过,但本步骤目的是锁定行为;若失败应为模块加载相关错误。先记录基线。

- [ ] **Step 3: 改为常量时间比较**

将 `apps/gateway/src/lib/auth.ts:31-33`:

```ts
export function verifyToken(token: string): boolean {
  return token === ROUTEBOX_TOKEN;
}
```

改为:

```ts
export function verifyToken(token: string): boolean {
  // C3: 常量时间比较,避免 token 计时侧信道
  const a = Buffer.from(token);
  const b = Buffer.from(ROUTEBOX_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

(`crypto` 已在文件顶部 `import crypto from "crypto";` 导入,无需新增。)

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/gateway && bun test src/lib/auth.test.ts`
Expected: PASS(3 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/gateway/src/lib/auth.ts apps/gateway/src/lib/auth.test.ts
git commit -m "fix(gateway): constant-time token comparison (C3)"
```

---

## Task 3: 启动日志不打印完整 token(C2a)

**Files:**
- Modify: `apps/gateway/src/lib/auth.ts:28-29`

- [ ] **Step 1: 掩码 token 日志**

将 `apps/gateway/src/lib/auth.ts:28-29`:

```ts
// Print token on startup so the user can configure their clients
console.log(`  ROUTEBOX_TOKEN=${ROUTEBOX_TOKEN}`);
```

改为:

```ts
// C2a: 不在日志中打印完整 token;只显示掩码前缀供识别
const masked = ROUTEBOX_TOKEN.length > 10
  ? `${ROUTEBOX_TOKEN.slice(0, 6)}…${ROUTEBOX_TOKEN.slice(-4)}`
  : "****";
console.log(`  ROUTEBOX_TOKEN=${masked} (full token in Settings / keychain)`);
```

- [ ] **Step 2: 手动验证日志不含完整 token**

Run:
```bash
cd apps/gateway && ROUTEBOX_TOKEN=rb_supersecretvalue1234567890 bun run src/index.ts 2>&1 | head -8 & \
  sleep 2 ; pkill -f "bun run src/index.ts"
```
Expected: 输出含 `ROUTEBOX_TOKEN=rb_sup…7890`,不含完整 `rb_supersecretvalue1234567890`。

- [ ] **Step 3: Commit**

```bash
git add apps/gateway/src/lib/auth.ts
git commit -m "fix(gateway): mask auth token in startup logs (C2a)"
```

---

## Task 4: 丢弃网关 stdout 避免泄露与缓冲死锁(C2b)

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands.rs:269`

**背景:** 当前 `.stdout(Stdio::piped())` 把网关 stdout 接到一个从不被读取的管道。诊断信息走 stderr(已被读取),stdout 只承载常规日志,留着管道不读既泄露(若被日志采集捕获)又可能在缓冲区写满时阻塞网关。改为 `Stdio::null()` 直接丢弃 stdout。

- [ ] **Step 1: 将 stdout 改为 null**

将 `apps/desktop/src-tauri/src/commands.rs:269`:

```rust
        .stdout(std::process::Stdio::piped())
```

改为:

```rust
        // C2b: 丢弃 gateway stdout —— 诊断走 stderr(下方会读取);
        // 不保留无人读取的管道,避免凭据泄露与管道缓冲写满导致的死锁
        .stdout(std::process::Stdio::null())
```

- [ ] **Step 2: 编译验证**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: 编译通过,无新增 warning/error。

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands.rs
git commit -m "fix(desktop): discard gateway stdout to prevent leak/deadlock (C2b)"
```

---

## Task 5: SSRF 白名单 + 禁重定向(H2-sec)

**Files:**
- Create: `apps/gateway/src/lib/ssrf.ts`
- Create: `apps/gateway/src/lib/ssrf.test.ts`
- Modify: `apps/gateway/src/lib/local-providers.ts:50-76` 和 `:140-151`

- [ ] **Step 1: 写失败测试**

Create `apps/gateway/src/lib/ssrf.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/gateway && bun test src/lib/ssrf.test.ts`
Expected: FAIL —— `Cannot find module './ssrf'` 或 `assertSafeLocalUrl is not a function`。

- [ ] **Step 3: 实现 ssrf.ts**

Create `apps/gateway/src/lib/ssrf.ts`:

```ts
// ---------------------------------------------------------------------------
// SSRF guard — 本地 provider 的 baseUrl 必须指向 loopback 或私有网段
// ---------------------------------------------------------------------------

/** 判断一个 IPv4 字符串是否属于 loopback / 私有 / link-local 网段 */
function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map(Number);
  if (oct.some((n) => n > 255)) return false;
  const [a, b] = oct;
  if (a === 127) return true;                 // 127.0.0.0/8 loopback
  if (a === 10) return true;                  // 10.0.0.0/8
  if (a === 192 && b === 168) return true;    // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  // 169.254.0.0/16 (link-local, 含云元数据 169.254.169.254) 一律拒绝
  return false;
}

/** 校验 URL 仅指向本机/私有网络;否则抛错。用于本地 provider 配置与探测。 */
export function assertSafeLocalUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported scheme: ${url.protocol}`);
  }
  let host = url.hostname.toLowerCase();
  // 去掉 IPv6 字面量的方括号
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  if (host === "localhost") return;
  if (host === "::1") return;                 // IPv6 loopback
  if (host.startsWith("fe80:")) return;       // IPv6 link-local (本机)
  if (isPrivateIpv4(host)) return;

  throw new Error(`Refusing non-local provider URL: ${rawUrl}`);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/gateway && bun test src/lib/ssrf.test.ts`
Expected: PASS(6 tests）

- [ ] **Step 5: 在探测前做校验并禁止重定向**

在 `apps/gateway/src/lib/local-providers.ts` 顶部 import 区(第 6 行 `import { loadSetting, saveSetting } from "./db";` 之后)加入:

```ts
import { assertSafeLocalUrl } from "./ssrf";
```

将 `probeLocalProvider`(`:50-76`)的 fetch 调用改为先校验、并禁止跟随重定向。具体把:

```ts
export async function probeLocalProvider(state: LocalProviderState): Promise<void> {
  try {
    const url = `${state.baseUrl}/models`;
    const headers: Record<string, string> = {};
    if (state.apiKey) headers["Authorization"] = `Bearer ${state.apiKey}`;
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(2000),
    });
```

改为:

```ts
export async function probeLocalProvider(state: LocalProviderState): Promise<void> {
  try {
    assertSafeLocalUrl(state.baseUrl); // H2-sec: 拒绝非本地/私有地址
    const url = `${state.baseUrl}/models`;
    const headers: Record<string, string> = {};
    if (state.apiKey) headers["Authorization"] = `Bearer ${state.apiKey}`;
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "error", // H2-sec: 禁止跟随重定向,防绕过白名单
      signal: AbortSignal.timeout(2000),
    });
```

(校验失败会抛错,落入既有的 `catch` 分支,将 provider 标记为离线 —— 行为安全且无需新增分支。)

- [ ] **Step 6: 在保存 URL 时拒绝非法地址**

将 `updateLocalProviderUrl`(`:140-151`)开头:

```ts
export async function updateLocalProviderUrl(name: string, baseUrl: string, apiKey?: string): Promise<LocalProviderState | undefined> {
  const lp = localProviders.find((p) => p.name === name);
  if (!lp) return undefined;
  lp.baseUrl = baseUrl.replace(/\/+$/, "");
```

改为:

```ts
export async function updateLocalProviderUrl(name: string, baseUrl: string, apiKey?: string): Promise<LocalProviderState | undefined> {
  const lp = localProviders.find((p) => p.name === name);
  if (!lp) return undefined;
  const normalized = baseUrl.replace(/\/+$/, "");
  assertSafeLocalUrl(normalized); // H2-sec: 保存前校验,非法地址直接抛错
  lp.baseUrl = normalized;
```

- [ ] **Step 7: 在 API 层把校验错误转为 400**

将 `apps/gateway/src/routes/api.ts:198-216` 的 handler 体包一层 try/catch。把:

```ts
app.put("/local-providers/:name/url", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ baseUrl: string; apiKey?: string }>();
  if (!body.baseUrl?.trim()) return c.json({ error: "baseUrl is required" }, 400);

  const updated = await updateLocalProviderUrl(name, body.baseUrl.trim(), body.apiKey?.trim());
  if (!updated) return c.json({ error: "Unknown local provider" }, 404);
```

改为:

```ts
app.put("/local-providers/:name/url", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ baseUrl: string; apiKey?: string }>();
  if (!body.baseUrl?.trim()) return c.json({ error: "baseUrl is required" }, 400);

  let updated;
  try {
    updated = await updateLocalProviderUrl(name, body.baseUrl.trim(), body.apiKey?.trim());
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400); // H2-sec: 非法 baseUrl
  }
  if (!updated) return c.json({ error: "Unknown local provider" }, 404);
```

- [ ] **Step 8: 运行网关测试套件确认无回归**

Run: `cd apps/gateway && bun test`
Expected: 全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add apps/gateway/src/lib/ssrf.ts apps/gateway/src/lib/ssrf.test.ts \
        apps/gateway/src/lib/local-providers.ts apps/gateway/src/routes/api.ts
git commit -m "fix(gateway): SSRF allowlist + no-redirect for local providers (H2-sec)"
```

---

## Task 6: 云端 CORS 不为 no-origin 返回通配(H3-sec)

**Files:**
- Modify: `apps/cloud-gateway/src/index.ts:48-52`

**背景:** 浏览器请求总会带 `Origin`;无 `Origin` 的是非浏览器客户端(Tauri/curl/服务端),它们不受 CORS 约束,因此无需也不应回 `*`。返回 `null` 即不下发 `Access-Control-Allow-Origin`,对非浏览器客户端零影响,同时去掉通配。

- [ ] **Step 1: 修改 origin 回调**

将 `apps/cloud-gateway/src/index.ts:48-52`:

```ts
    origin: (origin) => {
      // Non-browser requests (Tauri desktop, curl, server-to-server)
      if (!origin) return "*";
      return ALLOWED_ORIGINS.includes(origin) ? origin : null;
    },
```

改为:

```ts
    origin: (origin) => {
      // H3-sec: 非浏览器请求(无 Origin)不下发 ACAO —— CORS 仅约束浏览器,
      // 浏览器请求必带 Origin,故无需通配
      if (!origin) return null;
      return ALLOWED_ORIGINS.includes(origin) ? origin : null;
    },
```

- [ ] **Step 2: 手动验证(若本地可起云端)或代码评审确认**

若环境具备(已配 `DATABASE_URL` 等),Run:
```bash
cd apps/cloud-gateway && bun run src/index.ts & sleep 3 ; \
  curl -s -D - -o /dev/null http://localhost:8787/health -H "Origin: https://evil.example" | grep -i access-control-allow-origin ; \
  pkill -f "bun run src/index.ts"
```
Expected: 不出现 `access-control-allow-origin: *`(对未授权 Origin 无该响应头)。
若无法起服务,改为代码评审确认改动已生效。

- [ ] **Step 3: Commit**

```bash
git add apps/cloud-gateway/src/index.ts
git commit -m "fix(cloud): do not reflect ACAO '*' for no-origin requests (H3-sec)"
```

---

## Task 7: 网关 AES-256-GCM secrets 模块(M4-sec 基础)

**Files:**
- Create: `apps/gateway/src/lib/secrets.ts`
- Create: `apps/gateway/src/lib/secrets.test.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/gateway/src/lib/secrets.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/gateway && bun test src/lib/secrets.test.ts`
Expected: FAIL —— `Cannot find module './secrets'`。

- [ ] **Step 3: 实现 secrets.ts**

Create `apps/gateway/src/lib/secrets.ts`:

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/gateway && bun test src/lib/secrets.test.ts`
Expected: PASS(4 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/gateway/src/lib/secrets.ts apps/gateway/src/lib/secrets.test.ts
git commit -m "feat(gateway): add AES-256-GCM secrets module (M4-sec)"
```

---

## Task 8: 网关 provider key 与 token 落库加密(C2c + M4-sec)

**Files:**
- Modify: `apps/gateway/src/lib/db.ts:249-263`
- Modify: `apps/gateway/src/lib/auth.ts:1-24`
- Test: `apps/gateway/src/lib/db.test.ts` (Create)

- [ ] **Step 1: 写失败测试(provider key 加密落库)**

Create `apps/gateway/src/lib/db.test.ts`:

```ts
import { test, expect, beforeAll } from "bun:test";

// 使用独立临时 DB + 加密密钥,避免污染真实库
process.env.ROUTEBOX_DB_KEY = "1".repeat(64);
process.env.ROUTEBOX_DB_PATH = "/tmp/routebox-test-db.sqlite";

import { Database } from "bun:sqlite";
import { saveProviderKey, loadProviderKey, loadAllProviderKeys } from "./db";

test("provider key is stored encrypted but reads back as plaintext", () => {
  saveProviderKey("OpenAI", "sk-secret-abc123");

  // 读 API 返回明文
  const row = loadProviderKey("OpenAI");
  expect(row?.api_key).toBe("sk-secret-abc123");

  // 直接查底层表,值应为密文(不含明文)
  const raw = new Database(process.env.ROUTEBOX_DB_PATH!).query(
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/gateway && rm -f /tmp/routebox-test-db.sqlite* && bun test src/lib/db.test.ts`
Expected: FAIL —— `raw.api_key.startsWith("enc:v1:")` 为 false(当前明文存储)。

- [ ] **Step 3: 在 db.ts 读写处加解密**

在 `apps/gateway/src/lib/db.ts` 顶部 import 区(第 6 行 `import type { RequestRecord } from "./metrics";` 之后)加入:

```ts
import { encryptSecret, decryptSecret } from "./secrets";
```

将 `saveProviderKey` / `loadProviderKey` / `loadAllProviderKeys`(`:249-263`):

```ts
export function saveProviderKey(name: string, apiKey: string) {
  upsertProviderKey.run({ $name: name, $key: apiKey, $now: Date.now() });
}

export function removeProviderKey(name: string) {
  deleteProviderKeyStmt.run(name);
}

export function loadProviderKey(name: string): ProviderKeyRow | null {
  return (getProviderKeyStmt.get(name) as ProviderKeyRow | null) ?? null;
}

export function loadAllProviderKeys(): ProviderKeyRow[] {
  return getAllProviderKeysStmt.all() as ProviderKeyRow[];
}
```

改为:

```ts
export function saveProviderKey(name: string, apiKey: string) {
  upsertProviderKey.run({ $name: name, $key: encryptSecret(apiKey), $now: Date.now() });
}

export function removeProviderKey(name: string) {
  deleteProviderKeyStmt.run(name);
}

export function loadProviderKey(name: string): ProviderKeyRow | null {
  const row = (getProviderKeyStmt.get(name) as ProviderKeyRow | null) ?? null;
  if (row) row.api_key = decryptSecret(row.api_key);
  return row;
}

export function loadAllProviderKeys(): ProviderKeyRow[] {
  const rows = getAllProviderKeysStmt.all() as ProviderKeyRow[];
  for (const r of rows) r.api_key = decryptSecret(r.api_key);
  return rows;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/gateway && rm -f /tmp/routebox-test-db.sqlite* && bun test src/lib/db.test.ts`
Expected: PASS(2 tests）

- [ ] **Step 5: 加密持久化的 auth token(C2c)**

将 `apps/gateway/src/lib/auth.ts:1-24` 的 import 与 `resolveToken`:

```ts
import { createMiddleware } from "hono/factory";
import { loadSetting, saveSetting } from "./db";
import crypto from "crypto";

function resolveToken(): string {
  // 1. Environment variable takes priority
  const envToken = process.env.ROUTEBOX_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 2. Try loading from DB (persisted from a previous startup)
  const dbToken = loadSetting("routebox_token");
  if (dbToken) {
    console.log("  Auth token loaded from database.");
    return dbToken;
  }

  // 3. Generate a new random token and persist it
  const newToken = `rb_${crypto.randomBytes(24).toString("hex")}`;
  saveSetting("routebox_token", newToken);
  console.log("  Generated new auth token (saved to database).");
  return newToken;
}
```

改为:

```ts
import { createMiddleware } from "hono/factory";
import { loadSetting, saveSetting } from "./db";
import { encryptSecret, decryptSecret } from "./secrets";
import crypto from "crypto";

function resolveToken(): string {
  // 1. Environment variable takes priority (Tauri 从 keychain 注入)
  const envToken = process.env.ROUTEBOX_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 2. Try loading from DB (persisted from a previous standalone startup)
  const dbToken = loadSetting("routebox_token");
  if (dbToken) {
    console.log("  Auth token loaded from database.");
    return decryptSecret(dbToken); // C2c: 库内为密文(无密钥时 decrypt 透传旧明文)
  }

  // 3. Generate a new random token and persist it (encrypted)
  const newToken = `rb_${crypto.randomBytes(24).toString("hex")}`;
  saveSetting("routebox_token", encryptSecret(newToken)); // C2c
  console.log("  Generated new auth token (saved to database).");
  return newToken;
}
```

- [ ] **Step 6: 回归与确认**

Run: `cd apps/gateway && rm -f /tmp/routebox-test-db.sqlite* && bun test`
Expected: 全部 PASS(含 auth.test.ts、secrets.test.ts、db.test.ts 及既有测试)。

- [ ] **Step 7: Commit**

```bash
git add apps/gateway/src/lib/db.ts apps/gateway/src/lib/auth.ts apps/gateway/src/lib/db.test.ts
git commit -m "feat(gateway): encrypt provider keys and auth token at rest (C2c, M4-sec)"
```

---

## Task 9: 云端 AES-256-GCM 工具 + 环境校验(M4-sec)

**Files:**
- Modify: `apps/cloud-gateway/src/lib/crypto.ts`
- Create: `apps/cloud-gateway/src/lib/crypto.test.ts`
- Modify: `apps/cloud-gateway/src/lib/env.ts:7-30`

- [ ] **Step 1: 写失败测试**

Create `apps/cloud-gateway/src/lib/crypto.test.ts`:

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/cloud-gateway && bun test src/lib/crypto.test.ts`
Expected: FAIL —— `encryptSecret is not a function`。

- [ ] **Step 3: 在 crypto.ts 新增 AES-256-GCM**

将 `apps/cloud-gateway/src/lib/crypto.ts` 全文替换为(保留既有 `sha256Hex`,新增 import 与两个函数):

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/cloud-gateway && bun test src/lib/crypto.test.ts`
Expected: PASS(3 tests）

- [ ] **Step 5: 生产环境强制要求加密密钥**

将 `apps/cloud-gateway/src/lib/env.ts:26-30`(`Enforce minimum secret length` 块之后)新增校验。在该块之后插入:

```ts
  // M4-sec: provider key 静态加密密钥 —— 生产必须配置且为 64 hex(32 字节)
  const encKey = process.env.PROVIDER_KEY_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production") {
    if (!encKey) {
      log.fatal("missing_env_vars", { missing: ["PROVIDER_KEY_ENCRYPTION_KEY"] });
      process.exit(1);
    }
    if (encKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(encKey)) {
      log.fatal("insecure_encryption_key", { reason: "must be 64 hex chars (32 bytes)" });
      process.exit(1);
    }
  } else if (!encKey) {
    log.warn("encryption_key_absent", {
      message: "PROVIDER_KEY_ENCRYPTION_KEY not set — provider keys stored as plaintext (dev only)",
    });
  }
```

- [ ] **Step 6: Commit**

```bash
git add apps/cloud-gateway/src/lib/crypto.ts apps/cloud-gateway/src/lib/crypto.test.ts apps/cloud-gateway/src/lib/env.ts
git commit -m "feat(cloud): AES-256-GCM secret helpers + enforce encryption key in prod (M4-sec)"
```

---

## Task 10: 云端 provider key 落库加密(M4-sec)

**Files:**
- Modify: `apps/cloud-gateway/src/lib/provider-config.ts`

**说明:** `maskKey` 接收明文返回 `...xxxx`。加密后,落库存密文;凡是读出 `api_key` 用于「掩码展示」或「实际请求」处,先 `decryptSecret`。

- [ ] **Step 1: import 加解密**

在 `apps/cloud-gateway/src/lib/provider-config.ts` 顶部 import 区(第 6 行 `import { log } from "./logger";` 之后)加入:

```ts
import { encryptSecret, decryptSecret } from "./crypto";
```

- [ ] **Step 2: 创建时加密落库**

将 `createProviderKey`(`:55-59`)的 INSERT:

```ts
  const [row] = await sql`
    INSERT INTO provider_keys (provider_name, api_key, base_url, label)
    VALUES (${providerName}, ${apiKey}, ${baseUrl ?? null}, ${label ?? null})
    RETURNING id, provider_name, api_key, base_url, label, is_active, created_at
  `;
```

改为:

```ts
  const [row] = await sql`
    INSERT INTO provider_keys (provider_name, api_key, base_url, label)
    VALUES (${providerName}, ${encryptSecret(apiKey)}, ${baseUrl ?? null}, ${label ?? null})
    RETURNING id, provider_name, api_key, base_url, label, is_active, created_at
  `;
```

注意返回对象的 `maskedKey: maskKey(row.api_key ...)` 此时 `row.api_key` 是密文。将 `createProviderKey` 返回块里的:

```ts
    maskedKey: maskKey(row.api_key as string),
```

改为(此处用入参明文掩码,避免对密文取后 4 位):

```ts
    maskedKey: maskKey(apiKey),
```

- [ ] **Step 3: 更新 apiKey 时加密**

将 `updateProviderKey` 中(`:86-88`):

```ts
  if (updates.apiKey !== undefined) {
    await sql`UPDATE provider_keys SET api_key = ${updates.apiKey}, updated_at = now() WHERE id = ${id}`;
  }
```

改为:

```ts
  if (updates.apiKey !== undefined) {
    await sql`UPDATE provider_keys SET api_key = ${encryptSecret(updates.apiKey)}, updated_at = now() WHERE id = ${id}`;
  }
```

- [ ] **Step 4: 读取/列表/装载时解密**

`listProviderKeys`(`:38-46`)、`updateProviderKey` 末尾的 SELECT 回显(`:105-113`)、`loadDbProviderKeys`(`:149-157`)都需要在用 `api_key` 前解密。

(a) `listProviderKeys` 的 map 中 `maskedKey: maskKey(r.api_key as string)` 改为:

```ts
    maskedKey: maskKey(decryptSecret(r.api_key as string)),
```

(b) `updateProviderKey` 末尾 SELECT 后的返回块 `maskedKey: maskKey(row.api_key as string)` 改为:

```ts
    maskedKey: maskKey(decryptSecret(row.api_key as string)),
```

(c) `loadDbProviderKeys` 的 `configs.push({ ... apiKey: r.api_key as string ... })` 改为:

```ts
      apiKey: decryptSecret(r.api_key as string),
```

- [ ] **Step 5: 类型检查/启动验证**

Run: `cd apps/cloud-gateway && bun build src/lib/provider-config.ts --target=bun --outdir=/tmp/rb-typecheck 2>&1 | head` (或在已配置 env 时 `bun test`)
Expected: 无类型/语法错误。

- [ ] **Step 6: Commit**

```bash
git add apps/cloud-gateway/src/lib/provider-config.ts
git commit -m "feat(cloud): encrypt provider keys at rest, decrypt on read (M4-sec)"
```

---

## Task 11: Tauri 注入网关加密密钥(支撑 C2c/M4-sec 生产路径)

**Files:**
- Modify: `apps/desktop/src-tauri/src/keychain.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs:165-173` 和 `:264-268`

**说明:** 网关生产环境需要 `ROUTEBOX_DB_KEY`。复用现有 keychain 模式:首次生成 32 字节随机密钥存入 keychain,启动网关时作为 env 注入。

- [ ] **Step 1: keychain 增加 DB key 存取**

在 `apps/desktop/src-tauri/src/keychain.rs:5`(`const CLOUD_TOKEN_KEY ...` 之后)加入常量:

```rust
const DB_KEY_KEY: &str = "db_encryption_key";
```

并在文件末尾(`delete_cloud_token` 之后)追加:

```rust
pub fn store_db_key(key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, DB_KEY_KEY).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

pub fn get_db_key() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, DB_KEY_KEY).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
```

- [ ] **Step 2: commands.rs 生成/读取 DB key**

在 `apps/desktop/src-tauri/src/commands.rs:165-173`(token 解析块)之后,紧接着加入 DB key 解析:

```rust
    // M4-sec: 获取或生成 provider-key 静态加密密钥(64 hex = 32 bytes)
    let db_key = keychain::get_db_key()
        .ok()
        .flatten()
        .unwrap_or_else(|| {
            let mut bytes = [0u8; 32];
            getrandom::getrandom(&mut bytes).expect("failed to generate db key");
            let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
            let _ = keychain::store_db_key(&hex);
            hex
        });
```

- [ ] **Step 3: 启动网关时注入 env**

将 `apps/desktop/src-tauri/src/commands.rs:265-266`:

```rust
        .env("ROUTEBOX_TOKEN", &token)
        .env("ROUTEBOX_DB_PATH", db_path.to_string_lossy().to_string())
```

改为:

```rust
        .env("ROUTEBOX_TOKEN", &token)
        .env("ROUTEBOX_DB_KEY", &db_key)
        .env("ROUTEBOX_DB_PATH", db_path.to_string_lossy().to_string())
```

- [ ] **Step 4: 编译验证**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: 编译通过(`getrandom` 已是依赖,见 `generate_token`)。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/keychain.rs apps/desktop/src-tauri/src/commands.rs
git commit -m "feat(desktop): provision ROUTEBOX_DB_KEY from keychain for at-rest encryption (M4-sec)"
```

---

## Task 12: Tauri entitlements 收窄与说明(H4-sec)

**Files:**
- Modify: `apps/desktop/src-tauri/Entitlements.plist`

**说明:** 完整开启 App Sandbox 会破坏「spawn bun 子进程 + 访问真实 $HOME」,属较大改造,列入后续 backlog。本任务只做诚实记录:为每个 entitlement 标注用途,确认 `network.server` 是 loopback 监听所必需,移除/确认无用项。`files.user-selected.read-write` 若当前无文件选择交互可移除——执行者需先 grep 确认。

- [ ] **Step 1: 确认是否使用文件选择能力**

Run: `grep -rn "dialog\|FilePicker\|open(\|save(" apps/desktop/src apps/desktop/src-tauri/src | grep -iv "onClose\|openPanel\|window" | head`
Expected: 据结果判断 `files.user-selected.read-write` 是否仍被用到;若无任何文件选择交互,下一步将其移除,否则保留。

- [ ] **Step 2: 加注释并按上一步结论调整**

将 `apps/desktop/src-tauri/Entitlements.plist` 的 `<dict>` 内容改为(若 Step 1 判定文件选择仍需要,则保留该项并仅加注释;以下示例为「不需要、移除」的版本):

```xml
<dict>
  <!-- H4-sec: App Sandbox 暂未开启 —— 网关需 spawn bun 子进程并访问真实 $HOME,
       完整沙箱化列入后续 backlog(见 specs/2026-06-10-routebox-fixes-design.md 非目标)。 -->
  <key>com.apple.security.app-sandbox</key>
  <false/>
  <!-- 出站请求:访问 LLM provider API -->
  <key>com.apple.security.network.client</key>
  <true/>
  <!-- 本地代理在 127.0.0.1 监听,macOS 下监听 socket 需要此项 -->
  <key>com.apple.security.network.server</key>
  <true/>
</dict>
```

(若 Step 1 表明仍需文件选择,则在 `</dict>` 前保留:
```xml
  <!-- 用户主动选择的文件读写(导出/导入) -->
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
```
)

- [ ] **Step 3: 验证 plist 合法**

Run: `plutil -lint apps/desktop/src-tauri/Entitlements.plist`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/Entitlements.plist
git commit -m "chore(desktop): document/narrow Tauri entitlements (H4-sec)"
```

---

## Final Verification

- [ ] **网关全量测试**

Run: `cd apps/gateway && find . -path ./node_modules -prune -o -name '._*' -delete ; bun test`
Expected: 全部 PASS。

- [ ] **云端全量测试(若 env 具备)**

Run: `cd apps/cloud-gateway && bun test`
Expected: 全部 PASS(或仅因缺少 DATABASE_URL/Redis 等基础设施跳过的集成测试,非本次改动导致的失败)。

- [ ] **Rust 编译**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: 通过。

- [ ] **逐项核对验收(对照 spec Phase 0)**
  - C1 端口绑定 127.0.0.1(Task 1 Step 2 已验证)
  - C2a 日志掩码(Task 3 Step 2)
  - C2b stdout 丢弃(Task 4)
  - C2c token 密文落库(Task 8 Step 5)
  - C3 常量时间比较(Task 2)
  - H2-sec SSRF 拒绝元数据/公网地址(Task 5)
  - H3-sec CORS 无通配(Task 6)
  - H4-sec entitlements 已说明/收窄(Task 12)
  - M4-sec provider key 两端密文落库(Task 8、Task 10)

---

## Self-Review notes(作者自检)

- **Spec 覆盖:** Phase 0 表中 C1/C2a/C2b/C2c/C3/H2-sec/H3-sec/H4-sec/M4-sec 全部对应到 Task 1–12,无遗漏。主密钥策略(云端 env、本地 keychain)在 Task 9/11 落实。
- **类型一致性:** 两端加解密函数命名统一为 `encryptSecret`/`decryptSecret`;密文格式 `enc:v1:<iv>:<tag>:<ct>` 两端一致;`ProviderKeyRow.api_key`(网关)在读路径被原地解密,类型不变。
- **向后兼容:** 解密对非 `enc:v1:` 前缀透传,既有明文 key/token 不会损坏;dev 无密钥时加密透传,保证本地可用。
- **未决项(实现者注意):** Task 12 Step 1 的 grep 结论决定 `files.user-selected.read-write` 去留;Task 6 Step 2 的端口(示例用 8787)以云端实际监听端口为准。
