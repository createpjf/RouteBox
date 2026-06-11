# RouteBox 修复计划 — 设计文档

**日期:** 2026-06-10
**范围:** 全量修复(安全 + 代码质量 + UX)+ `packages/llm-core` 共享包重构
**来源:** 三维度只读审计(安全 / 代码质量 / UX)

## 背景与核心结论

RouteBox 是一个 macOS 菜单栏应用(Tauri + React),内置一个本地 LLM API 代理网关(`apps/gateway`),并有一个云端网关(`apps/cloud-gateway`,含 admin 面板、积分计费、key 池、JWT 鉴权)。

审计的核心发现:**云端网关质量明显好于本地网关,大量 bug 与安全问题源于两端代码复制后只修了云端一份**。本地网关缺少云端已有的熔断恢复、流式空闲超时、客户端断连传播等修复。因此本计划的地基是抽出共享包 `packages/llm-core`,让修复只做一遍。

## 组织方式:6 个阶段(方案 A)

按"先止血、再固本、后增益"排序。每个阶段是可独立合并、可独立验证的单元(建议每阶段一个 PR)。

- **依赖关系:** Phase 0 无依赖,可最先合并;Phase 2/3 依赖 Phase 1;Phase 4/5 独立于其他阶段。
- **测试策略:** 高风险路径(流式 / 计费 / 熔断)采用 TDD——每个 bug 先写一个会失败的复现测试,再修到绿。SSRF / 绑定地址 / UX 文案类用脚本或手动验证。
- **实现节奏:** 本设计一次性写全 6 阶段;实现时逐个阶段完整修复后再进入下一阶段。

---

## Phase 0 — 安全止血(无依赖,最先合并)

每项小且独立,一个 PR 内多个 commit。

| # | 改动 | 文件 | 做法 |
|---|------|------|------|
| C1 | 网关绑定 loopback | `apps/gateway/src/index.ts:127` | `export default` 加 `hostname: "127.0.0.1"` |
| C2a | token 不打印明文 | `apps/gateway/src/lib/auth.ts:29` | 改为掩码前缀,或 gate 在 debug flag 后 |
| C2b | drain 网关 stdout | `apps/desktop/src-tauri/src/commands.rs:269` | 读取/丢弃 stdout pipe,避免泄露 + 缓冲死锁 |
| C2c | token 不明文存 DB | `apps/gateway/src/lib/auth.ts:20` | 优先从 keychain 经 env 注入,去掉明文 settings 回退(或加密) |
| C3 | 常量时间比较 | `apps/gateway/src/lib/auth.ts:32` | `crypto.timingSafeEqual` + 长度守卫 |
| H2-sec | SSRF 白名单 | `apps/gateway/src/routes/api.ts:198`, `apps/gateway/src/lib/local-providers.ts:50` | baseUrl 限 loopback/RFC1918,拒绝 link-local/元数据段(169.254.0.0/16 等),probe/forward 禁重定向 |
| H3-sec | CORS 收紧 | `apps/cloud-gateway/src/index.ts:48` | no-origin 不返回 `"*"`,改为回显请求自身值或不设 CORS |
| H4-sec | Tauri entitlement | `apps/desktop/src-tauri/Entitlements.plist` | 评估开启 App Sandbox;至少收窄并注明 `network.server` 的必要性 |
| M4-sec | provider key 加密存储 | `apps/cloud-gateway/src/lib/provider-config.ts:55`, `apps/gateway/src/lib/db.ts:48` | AES-GCM 静态加密,运行时内存解密 |

**主密钥策略:** 云端用环境变量注入的 secret(与现有 JWT secret 同源管理),本地用 macOS keychain。

**验收:** 局域网扫描确认网关仅监听 127.0.0.1;启动日志不含完整 token;DB 中 token / provider key 为密文;SSRF 测试用例(指向 169.254.169.254、内网地址)被拒绝。

---

## Phase 1 — 抽 `packages/llm-core`(地基,纯迁移不改行为)

把两端复制漂移的约 600–800 行收敛到一个 pnpm workspace 包:

- **`registry`** — `PROVIDER_REGISTRY`,以 `apps/gateway/src/lib/providers.ts:132` 为基准,合并 `apps/cloud-gateway/src/lib/key-pool.ts:31` 的分叉前缀差异。
- **`adapters`** — Anthropic 请求适配,采用 gateway 的完整版 `apps/gateway/src/lib/providers.ts:425`(修复云端删减版静默丢弃 tool calls 与 image content 的问题)。
- **`sse`** — `anthropicStreamToOpenAI` / `openaiStreamPassthrough`,以云端带修复的版本为基线。
- **`pricing`** — `MODEL_PRICING` + `calculateCost` / `pricingFor`,统一两端数字。

**验收:** 两端改 import 后所有现有测试通过,行为零变化。这是纯结构迁移——所有 bug 留到 Phase 2/3 修,避免迁移与修复混在一起难以评审。

---

## Phase 2 — 流式/路由正确性(依赖 Phase 1,TDD)

每项先写复现测试再修,改在 `llm-core` 里一次惠及两端。

- **H1** fallback route bug — `apps/gateway/src/routes/proxy.ts:549` catch 重试成功路径补 `Object.assign(route, { provider, model, isFallback: true })`,删除误导的 `retriedProvider` 变量。当前 bug:重试成功后仍读原失败 provider,导致流式转换器选错格式分支、计费记错模型、响应头撒谎。
- **H2** 流式超时杀健康长流 — `apps/gateway/src/routes/proxy.ts:89` 与 `apps/cloud-gateway/src/routes/proxy.ts:852`:改为"首字节/响应头超时 + 流空闲超时",流开始后清除总超时计时器。
- **H3** provider 永不恢复 — `apps/gateway/src/lib/metrics.ts:375`:`failStreak >= 3` 判死后 router 不再选它故永无恢复机会。加恢复超时(距 `lastFailure` N 秒后视为恢复)或周期性后台重探,镜像云端 `circuit-breaker.ts`。
- **M8(并入 H3)** — `apps/gateway/src/routes/proxy.ts:536`:区分 timeout/abort 与连接拒绝,慢但健康的 provider 不应被三振判死。
- **H4** 断连不取消上游 + 溢出 enqueue 崩溃 — `apps/gateway/src/routes/proxy.ts:176,323`:移植云端 guarded `push()`、`callOnDone` once-latch、客户端 abort 传播(`c.req.raw.signal`);溢出 `controller.error()` 后正确终止,不再在 errored controller 上 enqueue。
- **M4** fallback 4xx 当成功 — `apps/gateway/src/routes/proxy.ts:585`:改为仅 `retryRes.ok` 才继续,否则返回上游错误状态。

---

## Phase 3 — 计费/账务正确性(TDD)

- **M1** fallback 计价错 — `apps/cloud-gateway/src/routes/proxy.ts:786`:按实际服务模型(`scored._scoredModelId`)重新解析价格,metrics 也记录实际服务模型。
- **M6** 充值幂等竞态 — `apps/cloud-gateway/src/lib/credits.ts:100`:为 `transactions.payment_ref` 加唯一(部分)索引;bonus 改用真正的 `idempotency_key` 列替代 `description LIKE` 匹配。
- **M2** 迁移锁失效 — `apps/cloud-gateway/src/lib/db-cloud.ts:81`:`pg_try_advisory_lock` 是会话级但跑在连接池上;改用 `sql.begin(...)` + `pg_advisory_xact_lock`,或使用保留连接。
- **M5** 指标 label 无界增长 — `apps/cloud-gateway/src/routes/proxy.ts:902`:只用 registry 校验过的 model id 作 label(否则归为 `"other"`),并转义 label 值防 Prometheus 输出污染。
- **L5** 配额扣减副作用 — `apps/cloud-gateway/src/lib/quota.ts:66`:provider 返回 4xx 时退还已扣配额。
- **M7-code** getStats 读时改基线 — `apps/gateway/src/lib/metrics.ts:316`:`prevRequests/prevTokens/prevCost` 每次调用被覆盖,多 WS 客户端时 delta 被打乱;改为对固定时间窗从 DB 计算 delta。

---

## Phase 4 — 便宜高收益 UX

- **H1-ux** 引导文案指错 tab — `apps/desktop/src/components/Onboarding.tsx:121`、`apps/desktop/src/components/Settings.tsx:580`:文案 "Activity" → "Account";Settings 按钮接已有的 `onGoToAccount` 实现真跳转(当前只 `onClose()`)。
- **H2-ux** 删除二次确认 + toast — `apps/desktop/src/components/AccountPage.tsx:80`、`apps/desktop/src/components/ProviderKeyManager.tsx:412`:加内联两步确认("Delete? / Yes"),错误经 toast 系统呈现(当前单击 5px 图标即不可逆吊销,失败仅 `console.warn`)。
- **H5-ux** 网关失败恢复入口 — `apps/desktop/src/components/HeroSection.tsx:105`:失败状态行可点击重试,或渲染阻断式 "Gateway failed — Retry / Open Settings" 卡片。
- **M5-ux** 余额轮询合并 + 可见性暂停 — `apps/desktop/src/App.tsx:204`(30s)与 `apps/desktop/src/hooks/useCloudAuth.ts:196`(10s)重复轮询且不在 `document.hidden` 暂停;合并为单一 hook 并在 `visibilitychange` 暂停。
- **M7-ux** 价格文案统一 — `apps/cloud-gateway/admin.html:236` 显示 $9.99,落地页/App 显示 $9.90;统一为正确值。
- **M6-ux** ProviderKeyManager 启动期自动重试 — `apps/desktop/src/components/ProviderKeyManager.tsx:31`:registry fetch 失败当前被静默吞掉;`gatewayState === "starting"` 时自动重试,并区分"网关启动中"与"网关不可达"。
- **L6-ux** Web Search key 保存失败提示 — `apps/desktop/src/components/Settings.tsx:296`:`catch {}` 改为呈现错误。
- **L4-ux** Activity 搜索扩展 — `apps/desktop/src/components/ActivityPage.tsx:34`:除 model 外也匹配 provider 与 status。

---

## Phase 5 — 大型产品项

- **托盘状态指示** — `apps/desktop/src-tauri/src/tray.rs:14`:运行/停止/失败图标切换 + 动态 tooltip + Start/Stop Gateway + Copy Endpoint 菜单项;经 Tauri event 从前端驱动状态变化。同时修 `tray.rs:15` 的 `default_window_icon().unwrap()` 启动期潜在 panic。
- **Admin 移动端适配** — `apps/cloud-gateway/admin.html:23`:加 media query / 响应式侧栏 / 模态自适应(当前 0 个 media query,手机上完全溢出)。**同时消除 `admin.html` 与 `admin/index.html` 的字节级重复**(改为单一来源,见 `apps/cloud-gateway/src/lib/admin-page.ts:7`),`landing.html` 与 `apps/landing/index.html` 同理。
- **Admin 登录表单语义(M1-ux)** — `apps/cloud-gateway/admin.html:119`:包 `<form onsubmit>`、加 `autocomplete="email"/"current-password"`、提交时禁用按钮防双提交、加登出入口(当前 JWT 存 localStorage 直到过期)。顺带修分页可翻过尾页(`admin.html:971` 等,Next 到尾页应禁用)。
- **网页注册/购买页(轻量版)** — `apps/landing/index.html:565`:当前 "Get Pro/Max" CTA 指向 `api.routebox.dev`(即落地页自身),形成死循环。**本次只做轻量版**:CTA 改指下载锚点 + 明确文案("下载 App,在 Account 标签内升级")。完整 web 注册/checkout 流程另开独立 spec。

**全局清理:** 删除仓库内散落的 macOS `._*` AppleDouble 垃圾文件并加入 `.gitignore`。

---

## 非目标(本计划不做)

- 完整的 web 注册 / checkout 流程(Phase 5 仅做轻量 CTA 修复;完整流程另开 spec)。
- 桌面端 i18n / 中文支持(L3-ux),除非另行确认目标受众。
- JWT 刷新令牌 / 撤销列表(M1-sec):当前 24h TTL + 每请求查 status 已可接受,列为 backlog。
- 无障碍/对比度全面整改(L1-ux / L2-ux):列为 backlog。
- Rust / 控制平面(`routes/api.ts`、`routes/admin.ts`)的全面测试补齐:列为 backlog。

## 验证总览

- **Phase 0:** 端口绑定扫描、日志检查、DB 密文检查、SSRF 拒绝用例。
- **Phase 1:** 两端现有测试全绿,行为零差异。
- **Phase 2/3:** 每个 bug 配一个先失败后通过的复现测试(TDD);流式用 mock provider 验证长流不被杀、断连取消上游、溢出不崩。
- **Phase 4:** 前端交互手动 + 现有 UI 测试;文案改动 grep 验证。
- **Phase 5:** 托盘状态在 Tauri 内手动验证;admin 在移动视口手动验证;CTA 链接检查。
