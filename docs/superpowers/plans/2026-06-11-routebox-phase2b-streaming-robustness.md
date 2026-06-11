# RouteBox Phase 2b — 流式健壮性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 就地修复两端的流式健壮性问题 —— 网关流式转换器崩溃/卡死/不可取消(H4)、总超时杀健康长流(H2)、客户端断连不传播、abort 被误记为 provider down(M8);云端清除流式开始后仍在跑的整体超时(H2)。两端各自保留现有能力(网关的 tool 流式、云端的健壮性),不做共享转换器抽取(列为后续维护重构)。

**Architecture:** 改动集中在 `apps/gateway/src/routes/proxy.ts`(两个 SSE 转换器 + forward/handler 的超时与 abort 接线)与 `apps/cloud-gateway/src/routes/proxy.ts`(整体超时的清除时机)。网关移植云端已验证的模式:guarded enqueue、`callOnDone` once-latch、空闲计时器(`reader.cancel`)、溢出不崩溃、断流 token 估算;并把 `forward` 的「整段 fetch 超时」改为「首字节超时(连接阶段)+ 流开始后交给空闲计时器」,同时把客户端 `c.req.raw.signal` 传播到上游。

**Tech Stack:** TypeScript + Bun(`bun test`,gateway 现 68/0)。流式超时常量做成 env 可覆盖,便于测试用小值确定性触发。

**Phase 2 拆分:** 这是 Phase 2 的第二半(2a 已完成路由/正确性 H1/M4/H3)。SSE 转换器/Anthropic 适配器抽取到 `llm-core` 经评估为「能力分叉的大合并」,本期**不做**,留作后续纯维护重构。

---

## 背景:bug 精确定位(已读码确认)

**网关 `apps/gateway/src/routes/proxy.ts`:**
- **H4-崩溃**:`anthropicStreamToOpenAI`(`:177-179`)与 `openaiStreamPassthrough`(`:324-327`)在缓冲溢出时 `controller.error(...)` 后 `break`,但执行继续到循环后的 `pushChunk(meta)`/`controller.close()`(`:282-294`、`:373-388`)→ 在已 error 的 controller 上 enqueue 抛错 → `start()` 异步 reject(未处理),且 `onDone` 不执行 → 请求不被记录。
- **H4-不可取消 + enqueue 不安全**:`pushChunk`/`controller.enqueue` 未 try/catch(客户端断开后 enqueue 抛错);无 `cancel()`、不监听 `c.req.raw.signal`,客户端断开后上游 reader 仍读完整响应(token 照烧)。
- **H2-超时杀流**:`forwardOpenAI`/`forwardAnthropic`(`:90`、`:108`)用 `AbortSignal.timeout(30_000)`(本地 120_000)覆盖整段 fetch(含流式 body 消费);任何总耗时 >30s 的流式生成被中断为 `stream_error`。
- **M8**:catch(`:538`)对任何 throw(含上面的 30s timeout abort、客户端 abort)都 `markProviderDown`;慢但健康、或客户端主动断开,都被记为 provider 故障。

**云端 `apps/cloud-gateway/src/routes/proxy.ts`:**
- **H2**:整体 `requestTimeout = setTimeout(abort, REQUEST_TIMEOUT_MS=60_000)`(`:848`)只在 `onDone`(`:1070`,流结束后)清除 → 健康长流在 60s 被 abort。云端已有空闲计时器(`STREAM_IDLE_TIMEOUT_MS`)覆盖「卡死流」场景,故整体超时应在**流开始时**清除。

**参考实现:** 云端 `anthropicStreamToOpenAI`/`openaiStreamPassthrough`(`cloud-gateway/src/routes/proxy.ts:228-470`)已含 guarded `push`/`enqueue`、`callOnDone` once-latch(`doneCalled`)、`resetIdleTimer`(`reader.cancel`)、`resolveOutputTokens`、溢出推 error 事件后 `break`(不 `controller.error`)。网关移植这些模式,但**保留**网关版的 tool_use 流式逻辑(云端版没有)。

---

## File Structure

| 文件 | 责任 | 操作 |
|------|------|------|
| `apps/gateway/src/routes/proxy.ts` | SSE 转换器 + forward/handler 超时/abort | Modify |
| `apps/gateway/src/routes/proxy.test.ts` | 溢出不崩溃 + once-latch + 长流不被杀 测试 | Modify |
| `apps/cloud-gateway/src/routes/proxy.ts` | 流开始时清除整体超时 | Modify |

**执行者必读:**
- 测试:`cd apps/gateway && bun test`(现 68/0);提交前 `find . -path ./node_modules -prune -o -name '._*' -delete`。忽略 `non-monotonic index` 警告。分支 `fix/audit-remediation`。
- gateway 全套同进程跑,`metrics` 单例共享 —— 新测试若动 provider 健康态须 finally 复位(参考 proxy.test.ts 既有 M4/H1 测试的 `reset()`)。
- 流式超时常量做成 env 可覆盖(`ROUTEBOX_STREAM_IDLE_MS`),测试用小值(如 200ms)确定性触发空闲取消,避免 30s 等待。

---

## Task 1: 网关转换器健壮化(H4 + 空闲计时器)

**Files:**
- Modify: `apps/gateway/src/routes/proxy.ts`
- Modify: `apps/gateway/src/routes/proxy.test.ts`

对 **两个** 转换器 `anthropicStreamToOpenAI`、`openaiStreamPassthrough` 应用同一组结构性改动,保留各自现有的 chunk 发射逻辑(尤其 anthropic 版的 tool_use 处理)。

- [ ] **Step 1: 加空闲超时常量**

在 `apps/gateway/src/routes/proxy.ts:24`(`const MAX_STREAM_BUFFER = ...`)之后加入:
```ts
const STREAM_IDLE_TIMEOUT_MS = Number(process.env.ROUTEBOX_STREAM_IDLE_MS) || 30_000; // 无数据超过此时长则关闭流
```

- [ ] **Step 2: 写失败测试(溢出不崩溃 + 记录)**

先扩展 mock,使其能按请求产出一个「超大无换行」流以触发溢出。在 `apps/gateway/src/routes/proxy.test.ts` 的 mock streaming 分支(`if (body.stream)`)开头,按 sentinel 产出不同流。找到 `if (body.stream) {` 块,在其内最前面加入:
```ts
            // 溢出测试:首条 user 消息含 __OVERFLOW__ 时,产出一个 >1MB 的无换行块
            const firstContent = Array.isArray(body.messages) && typeof body.messages[0]?.content === "string"
              ? body.messages[0].content as string : "";
            if (firstContent.includes("__OVERFLOW__")) {
              const huge = "x".repeat(1024 * 1024 + 10);
              const ovStream = new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode(`data: {"choices":[{"delta":{"content":"${huge}"}}]}`));
                  controller.close();
                },
              });
              return new Response(ovStream, { headers: { "Content-Type": "text/event-stream" } });
            }
```
然后在 `describe("POST /v1/chat/completions", ...)` 内加测试:
```ts
  test("H4: stream buffer overflow does not crash; emits error event and [DONE]", async () => {
    const res = await proxyRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "__OVERFLOW__ please" }],
      stream: true,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // 不崩溃:仍能读到完整响应体,含溢出错误事件与结束标记
    expect(text).toContain("stream_overflow");
    expect(text).toContain("[DONE]");
  });
```

- [ ] **Step 3: 运行确认失败**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; find . -name '._*' -delete 2>/dev/null; bun test src/routes/proxy.test.ts -t "H4"`
Expected: FAIL —— 当前溢出路径 `controller.error` 后继续 enqueue 抛错,响应体不含 `stream_overflow`/`[DONE]`(或流以异常中断)。

- [ ] **Step 4: 健壮化 `anthropicStreamToOpenAI`**

在该函数顶部的状态变量区(`let toolCallIndex = -1;` 之后,约 `:162`)加入:
```ts
  let streamedChars = 0;
  let doneCalled = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resolveOutputTokens = () => (outputTokens > 0 ? outputTokens : Math.ceil(streamedChars / 4));
  const callOnDone = (usage: { input: number; output: number }) => {
    if (doneCalled) return;
    doneCalled = true;
    if (idleTimer) clearTimeout(idleTimer);
    onDone(usage);
  };
```
把内部的 `function pushChunk(data: string)`(`:168-170`)改为 guarded:
```ts
      function pushChunk(data: string) {
        try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
      }
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          reader.cancel().catch(() => {});
          try { controller.close(); } catch { /* already closed */ }
          callOnDone({ input: inputTokens, output: resolveOutputTokens() });
        }, STREAM_IDLE_TIMEOUT_MS);
      };
      resetIdleTimer();
```
在 `while (true)` 循环里、`if (done) break;` 之后加入 `resetIdleTimer();`。
在文本增量处理(`text_delta` 分支,`:221` 附近,push content 之前)加入累计:`streamedChars += (evt.delta.text as string).length;`
把溢出处理(`:177-180`):
```ts
          if (buffer.length > MAX_STREAM_BUFFER) {
            controller.error(new Error("Stream buffer overflow"));
            break;
          }
```
改为(推错误事件后 break,**不**调用 `controller.error`,使循环后的收尾安全执行):
```ts
          if (buffer.length > MAX_STREAM_BUFFER) {
            pushChunk(JSON.stringify({
              error: { message: "Stream buffer overflow — response truncated", type: "server_error", code: "stream_overflow" },
            }));
            break;
          }
```
把 `finally { reader.releaseLock(); }` 之后的收尾段(`:279-295`)改为:在 `pushChunk([DONE])`/`controller.close()` 前后用 `resolveOutputTokens()` 计算 meta,并把 `controller.close()` 包 try/catch、把 `onDone(...)` 换成 `callOnDone(...)`。具体:
```ts
      if (idleTimer) clearTimeout(idleTimer);

      const finalOutput = resolveOutputTokens();
      const totalTokens = inputTokens + finalOutput;
      const metaCost = calculateCost(model, inputTokens, finalOutput, streamMeta.provider);
      pushChunk(JSON.stringify({
        object: "routebox.meta",
        provider: streamMeta.provider.toLowerCase(),
        model,
        requested_model: streamMeta.requestedModel,
        usage: { prompt_tokens: inputTokens, completion_tokens: finalOutput, total_tokens: totalTokens },
        cost: metaCost,
        latency_ms: Math.round(performance.now() - streamMeta.startMs),
        is_fallback: streamMeta.isFallback,
      }));
      pushChunk("[DONE]");
      try { controller.close(); } catch { /* already closed */ }
      callOnDone({ input: inputTokens, output: finalOutput });
```

- [ ] **Step 5: 健壮化 `openaiStreamPassthrough`(同样的五处)**

在状态变量区(`let metaInjected = false;` 之后,约 `:311`)加入相同的 `streamedChars/doneCalled/idleTimer/resolveOutputTokens/callOnDone`。
把内部 enqueue 包一层 guarded helper:在 `const reader = upstream.getReader();`/`const encoder = ...` 之后加入:
```ts
      const enqueue = (data: Uint8Array) => { try { controller.enqueue(data); } catch { /* closed */ } };
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          reader.cancel().catch(() => {});
          try { controller.close(); } catch { /* already closed */ }
          callOnDone({ input: inputTokens, output: resolveOutputTokens() });
        }, STREAM_IDLE_TIMEOUT_MS);
      };
      resetIdleTimer();
```
把该函数内所有 `controller.enqueue(...)` 调用替换为 `enqueue(...)`。
在 `if (done) break;` 之后加 `resetIdleTimer();`。
在解析 chunk 累计内容处(`:351-355` 的 try 内,解析出 delta 后)加入:`const _d = chunk.choices?.[0]?.delta; if (_d?.content) streamedChars += (_d.content as string).length;`(放在已有的 usage 累计旁)。
把溢出处理(`:324-327`):
```ts
          if (buffer.length > MAX_STREAM_BUFFER) {
            controller.error(new Error("Stream buffer overflow"));
            break;
          }
```
改为:
```ts
          if (buffer.length > MAX_STREAM_BUFFER) {
            enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: "Stream buffer overflow — response truncated", type: "server_error", code: "stream_overflow" } })}\n\n`));
            break;
          }
```
收尾段(`:369-389`):在 fallback meta 注入前加 `if (idleTimer) clearTimeout(idleTimer);`;把 `metaInjected` 分支里的 token 用 `resolveOutputTokens()`;把 `controller.close()` 包 try/catch;`onDone(...)` 换 `callOnDone(...)`。注意保留既有的 `[DONE]`/meta 注入逻辑结构,仅替换 enqueue→guarded、close→try/catch、onDone→callOnDone、output token→resolveOutputTokens。

- [ ] **Step 6: 运行 H4 测试确认通过 + 既有流式测试仍过**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; find . -name '._*' -delete 2>/dev/null; bun test src/routes/proxy.test.ts`
Expected: 全 PASS(含新 H4 测试 + 既有 "streaming: returns SSE with [DONE]")。

- [ ] **Step 7: 全套回归 + 提交**

Run: `bun test`(期望全 PASS)。
```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/gateway/src/routes/proxy.ts apps/gateway/src/routes/proxy.test.ts
git commit -m "fix(gateway): harden SSE transformers — guarded enqueue, once-latch, no-crash overflow, idle timer (H4)"
```

---

## Task 2: 网关 forward/handler 超时与 abort 重构(H2 + 断连传播 + M8)

**Files:**
- Modify: `apps/gateway/src/routes/proxy.ts`

目标:连接/首字节阶段有超时(防卡在握手),但流式 body 一旦开始就交给 Task 1 的空闲计时器,不再被整段超时杀死;客户端断开传播到上游;客户端 abort 不记 provider down(M8)。

- [ ] **Step 1: `forward` 系列接受外部 AbortSignal**

把 `forwardOpenAI`(`:68-92`)、`forwardAnthropic`(`:94-110`)、`forward`(`:112-119`)的签名各加一个可选 `signal?: AbortSignal`,并把 fetch 里的 `signal: AbortSignal.timeout(...)` 改为 `signal: signal ?? AbortSignal.timeout(provider.isLocal ? 120_000 : 30_000)`(forwardOpenAI)/`signal: signal ?? AbortSignal.timeout(30_000)`(forwardAnthropic)。`forward(provider, body, signal)` 透传 signal 给两者。保留 `redirect: "error"`。

- [ ] **Step 2: handler 里建 AbortController + 首字节超时 + 断连传播**

在主 handler `app.post("/chat/completions", ...)` 里、`const startMs = performance.now();`(`:530`)之后、`let res: Response;` 之前,加入:
```ts
  // 客户端断连 → 取消上游;首字节阶段超时,流开始后交给空闲计时器
  const clientSignal = c.req.raw.signal;
  const abortController = new AbortController();
  const upstreamSignal = abortController.signal;
  const onClientAbort = () => abortController.abort();
  clientSignal?.addEventListener("abort", onClientAbort, { once: true });
  const CONNECT_TIMEOUT_MS = Number(process.env.ROUTEBOX_CONNECT_TIMEOUT_MS) || 30_000;
  let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => abortController.abort(), CONNECT_TIMEOUT_MS);
  const clearConnectTimer = () => { if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; } };
```

- [ ] **Step 3: 所有 `forward(...)` 调用传入 `upstreamSignal`**

把 handler 内三处 `await forward(provider, body)` / `await forward(fallback.provider, body)`(`:536`、`:551`、`:586`)都改为传入 `upstreamSignal`,例如 `await forward(provider, body, upstreamSignal)`。

- [ ] **Step 4: M8 —— 客户端 abort 不记 provider down**

把首个 catch(`:537-538`):
```ts
  } catch (err) {
    metrics.markProviderDown(provider.name);
```
改为(客户端主动断开时不计 provider 故障):
```ts
  } catch (err) {
    if (!clientSignal?.aborted) metrics.markProviderDown(provider.name);
```
(catch 内 fallback 失败的 `markProviderDown(fallback.provider.name)`、以及 5xx 路径的 markProviderDown 同理可加 `if (!clientSignal?.aborted)` 守卫——对每处 markProviderDown 调用加同一守卫。)

- [ ] **Step 5: 流式开始时清除连接超时;非流式在读完后清除**

在「Streaming response」分支(`:641`,`if (isStream && res!.body) {` 内,构造 stream 之前)加入 `clearConnectTimer();`(此后由转换器空闲计时器治理;客户端断连仍经 `upstreamSignal` 传播)。
在「Non-streaming response」分支(`:678`,`const latencyMs = ...` 之前)加入:
```ts
  clearConnectTimer();
  clientSignal?.removeEventListener("abort", onClientAbort);
```
另外,流式分支返回前无需移除断连监听(断连要继续传播);但 `onClientAbort` 用了 `{ once: true }`,触发后自动移除,无泄漏。

- [ ] **Step 6: 验证 —— 长流不再被整段超时杀死(用小超时值确定性测试)**

在 `proxy.test.ts` 加测试:把 `ROUTEBOX_CONNECT_TIMEOUT_MS` 设为很小(如 300ms),mock 在首字节后延迟 >300ms 再发后续 chunk,断言流仍完整(不被连接超时中断)。由于 env 在模块加载时读入 handler 内是每请求读取(`Number(process.env...)` 在 handler 体内)——确认 Step 2 的常量是在 handler **体内**读取 env(每请求求值),以便测试可在请求前 `process.env.ROUTEBOX_CONNECT_TIMEOUT_MS = "300"`。给出测试:
```ts
  test("H2: streaming response is not killed by the connect timeout once data flows", async () => {
    process.env.ROUTEBOX_CONNECT_TIMEOUT_MS = "300";
    try {
      const res = await proxyRequest({
        model: "gpt-4o",
        messages: [{ role: "user", content: "__SLOWSTREAM__" }],
        stream: true,
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("[DONE]");
      expect(text).toContain("world"); // 慢 chunk 仍送达
    } finally {
      delete process.env.ROUTEBOX_CONNECT_TIMEOUT_MS;
    }
  });
```
并在 mock streaming 分支加 sentinel `__SLOWSTREAM__`:首 chunk 立即发,第二个 chunk 用 `await Bun.sleep(500)` 后发(>300ms 连接超时),最后 `[DONE]`。若 Step 2 把 `CONNECT_TIMEOUT_MS` 写成模块级常量(只读一次),改为 handler 体内读取,确保测试可控。

- [ ] **Step 7: 全套回归 + 提交**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; find . -name '._*' -delete 2>/dev/null; bun test`
Expected: 全 PASS。
```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/gateway/src/routes/proxy.ts apps/gateway/src/routes/proxy.test.ts
git commit -m "fix(gateway): TTFB timeout + client-abort propagation; stream not killed by total timeout; abort not marked down (H2, M8)"
```

---

## Task 3: 云端整体超时在流开始时清除(H2)

**Files:**
- Modify: `apps/cloud-gateway/src/routes/proxy.ts`

- [ ] **Step 1: 流式分支开始处清除整体超时**

在「Streaming response」分支(`:1051`,`if (isStream && res.body) {` 内最前面)加入:
```ts
    // H2: 流已开始 —— 清除整体请求超时,改由转换器空闲计时器治理;
    // 客户端断连仍经 abortController 传播到上游
    clearTimeout(requestTimeout);
```
`onDone`(`:1070`)里既有的 `clearTimeout(requestTimeout)` 保留(幂等,无害)。客户端断连监听 `onClientAbort` 仍需在 `onDone` 里移除(已有,`:1071`),不动。

- [ ] **Step 2: 验证 bundle**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway && bun build src/routes/proxy.ts --target=bun --outdir=/tmp/cl-proxy-h2`
Expected: bundle 成功。

- [ ] **Step 3: 回归(不需基础设施的单测)**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway && find . -name '._*' -delete 2>/dev/null; bun test src/lib/key-pool.test.ts src/lib/metrics.test.ts src/lib/credits.test.ts`
Expected: PASS(若有 proxy 相关单测也跑;需基础设施的集成测试环境缺失属正常)。

- [ ] **Step 4: 提交**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/src/routes/proxy.ts
git commit -m "fix(cloud): clear overall request timeout once streaming begins so long streams aren't killed (H2)"
```

---

## Task 4: Final —— 全量回归 + 终审

- [ ] **Step 1: 两端测试**

Run:
```
cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; find . -name '._*' -delete 2>/dev/null; bun test
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway && bun test src/lib/key-pool.test.ts src/lib/metrics.test.ts src/lib/credits.test.ts
```
Expected: gateway 全 PASS;cloud 上述单测 PASS。

- [ ] **Step 2: 派终审 reviewer**

重点:(a) 两个网关转换器的五处健壮化都到位(guarded enqueue、once-latch、溢出不崩溃且收尾安全、空闲计时器、resolveOutputTokens),且**保留** anthropic 版的 tool_use 流式逻辑;(b) forward/handler 的连接超时在流开始时清除、客户端断连经 `upstreamSignal` 传播到所有 forward 调用、所有 markProviderDown 加了 `!clientSignal?.aborted` 守卫(M8);(c) 云端整体超时在流开始时清除且 onDone 清除仍幂等;(d) 无新增竞态(idleTimer 与正常收尾的双重 callOnDone 被 once-latch 吸收);(e) 既有流式行为/meta 注入不变。

---

## Self-Review notes(作者自检)

- **范围:** 仅就地修两端流式 bug(H2/H4/M8 网关 + H2 云端),不抽共享转换器(能力分叉的大合并,留后续维护重构)。两端各自保留现有能力。
- **once-latch 必要性:** 加空闲计时器后,「空闲触发的 callOnDone」与「正常收尾的 callOnDone」可能都跑;`doneCalled` 确保 onDone(记账)只执行一次。
- **H2 设计:** 连接/首字节阶段有超时(防握手卡死),`await forward` 拿到 headers 即 `clearConnectTimer`;流式 body 此后由转换器空闲计时器(无数据 30s)治理,健康长流不再被杀。非流式仍在读完后清除。常量在 handler 体内读 env,测试可用小值确定性触发。
- **M8:** 对每处 `markProviderDown` 加 `!clientSignal?.aborted` 守卫——客户端主动断开不算 provider 故障;真实连接失败/首字节超时仍计入(配合 2a 的 H3 恢复冷却,不会永久禁用)。
- **测试可行性:** 溢出(确定性,sentinel)、长流不被连接超时杀(小超时 + 慢 mock chunk)可确定性测;真正的 30s 空闲取消不做实时等待测试(常量已可 env 覆盖,留给手动/后续)。
- **依赖:** 依赖 2a 已合入(同一 proxy.ts);与 Phase 3 无耦合。
