# RouteBox Phase 4 — 便宜高收益 UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复一批低风险、用户可感知的桌面端 UX 问题:引导/设置文案指错 tab(H1)、删除无确认且失败静默(H2)、网关失败无恢复入口(H5)、余额轮询不暂停(M5)、provider 列表启动期死路(M6)、Web Search key 保存失败静默(L6)、Activity 搜索只匹配 model(L4)。

**Architecture:** 纯前端,改动在 `apps/desktop/src`(React + Tauri)。无后端/网络协议变化。导航复用既有 `setActiveTab`(App.tsx 已向 HeroSection 传 `onGoToAccount={() => setActiveTab("account")}`);本期把同样的回调也接到 Settings。删除确认用组件内联两步状态(不引入全局确认框)。轮询暂停用 `document.hidden` + `visibilitychange`。

**Tech Stack:** TypeScript + React + Vite + Tauri。验证:`cd apps/desktop && bunx tsc --noEmit`(类型)+ `bun run test`(vitest,既有 3 个 UI 测试不可回归)。无新测试基础设施要求——这些是小改动,主要靠类型检查 + 评审 + 可选 preview 验证。

**已移出本期:** M7(Pro 价格 $9.90 vs $9.99)——价格未定,用户决定暂不动。

---

## File Structure

| 文件 | 项 | 操作 |
|------|----|------|
| `apps/desktop/src/components/Onboarding.tsx` | H1 文案 Activity→Account | Modify |
| `apps/desktop/src/components/Settings.tsx` | H1 按钮跳转 + L6 错误提示 | Modify |
| `apps/desktop/src/App.tsx` | H1 给 Settings 传 onGoToAccount;M5 轮询暂停 | Modify |
| `apps/desktop/src/components/AccountPage.tsx` | H2 删除确认 + 错误提示 | Modify |
| `apps/desktop/src/components/ProviderKeyManager.tsx` | H2 删除确认;M6 启动期状态 | Modify |
| `apps/desktop/src/components/HeroSection.tsx` | H5 失败状态可点击打开设置 | Modify |
| `apps/desktop/src/hooks/useCloudAuth.ts` | M5 轮询暂停 | Modify |
| `apps/desktop/src/components/ActivityPage.tsx` | L4 搜索扩展 | Modify |

**执行者必读:**
- 验证:`cd /Volumes/ROG_500GB/RouteBox/apps/desktop && bunx tsc --noEmit`(应无新错误)+ `bun run test`(vitest 既有测试全过)。提交前 `find . -path ./node_modules -prune -o -name '._*' -delete`。忽略 `non-monotonic index` 警告。分支 `fix/audit-remediation`。
- 这些是独立小改动;每个任务一个 commit。改动遵循各文件既有样式(Tailwind class、lucide 图标、`text-[11px]` 等)。

---

## Task 1: H1 —— 引导/设置文案指向正确的 Account tab + Settings 真跳转

**Files:** `Onboarding.tsx`、`Settings.tsx`、`App.tsx`

- [ ] **Step 1: Onboarding 文案 Activity → Account**

`apps/desktop/src/components/Onboarding.tsx:120-128`,把两处 `Activity` 改为 `Account`:
- `:121` `Go to the <span ...>Activity</span> tab to sign in...` → `...Account</span> tab to sign in...`
- `:126` `Your gateway endpoint and API key are shown in the <span ...>Activity</span> tab...` → `...Account</span> tab...`

- [ ] **Step 2: Settings 增加导航回调 prop**

`apps/desktop/src/components/Settings.tsx`:
- `:29-31` 接口:
```ts
interface SettingsProps {
  onClose: () => void;
}
```
改为:
```ts
interface SettingsProps {
  onClose: () => void;
  onGoToAccount?: () => void;
}
```
- `:33` `export function Settings({ onClose }: SettingsProps) {` 改为 `export function Settings({ onClose, onGoToAccount }: SettingsProps) {`

- [ ] **Step 3: Settings 两个按钮文案改 Account 并真跳转**

`Settings.tsx:576-582` 与 `:587-593`,两个按钮当前 `onClick={onClose}` + 文案 "Go to Activity"/"Sign in via Activity"。改为先跳转再关闭,文案改 Account:
- 第一个:`onClick={() => { onGoToAccount?.(); onClose(); }}`,文案 `Go to Account`
- 第二个:`onClick={() => { onGoToAccount?.(); onClose(); }}`,文案 `Sign in via Account`

- [ ] **Step 4: App.tsx 给 Settings 传 onGoToAccount**

`apps/desktop/src/App.tsx:346` 的 `<Settings onClose={...} />`,加 `onGoToAccount={() => setActiveTab("account")}`(与 `:293` HeroSection 用法一致)。READ 该处确认现有 props,保留 onClose 不动。

- [ ] **Step 5: 验证 + 提交**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/desktop && bunx tsc --noEmit && bun run test`
Expected: 类型无新错误;vitest 全过。
```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/desktop/src/components/Onboarding.tsx apps/desktop/src/components/Settings.tsx apps/desktop/src/App.tsx
git commit -m "fix(desktop): onboarding/settings point to Account tab and actually navigate (H1-ux)"
```

---

## Task 2: H2 —— 删除 API key / provider key 两步确认 + 失败提示

**Files:** `AccountPage.tsx`、`ProviderKeyManager.tsx`

当前:AccountPage `handleDelete`(`:80-85`)单击即吊销、失败仅 `console.warn`;ProviderKeyManager 删除按钮(`:411-417`)直接 `handleDeleteKey`(`:69-77`,有 `setError` 但删除按钮在非编辑态、error 不可见)。改为内联两步确认 + 可见错误。

- [ ] **Step 1: AccountPage 内联确认 + 错误**

`apps/desktop/src/components/AccountPage.tsx`:
- 在组件状态区加:`const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);` 和 `const [deleteError, setDeleteError] = useState<string | null>(null);`(READ 文件顶部确认 `useState` 已 import)。
- `handleDelete`(`:80-85`)改为surface错误:
```ts
  const handleDelete = async (id: string) => {
    try {
      await api.cloudDeleteApiKey(id);
      setConfirmingDelete(null);
      setDeleteError(null);
      await loadKeys();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete key");
    }
  };
```
- 删除按钮(`:172-178`)改为两步:第一次点击设 `setConfirmingDelete(k.id)`,显示 "Delete?" 确认;再点确认才 `handleDelete(k.id)`。具体把该 `<button onClick={() => handleDelete(k.id)} ...>` 替换为条件渲染:
```tsx
              {confirmingDelete === k.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleDelete(k.id)}
                    className="text-[9px] text-accent-red font-medium px-1.5 h-5 rounded hover:bg-accent-red/10"
                  >
                    Delete?
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(null)}
                    className="text-[9px] text-text-tertiary px-1.5 h-5 rounded hover:bg-hover-overlay"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setDeleteError(null); setConfirmingDelete(k.id); }}
                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-accent-red/10 transition-colors shrink-0"
                  title="Delete key"
                >
                  <Trash2 size={10} strokeWidth={1.75} className="text-text-tertiary hover:text-accent-red" />
                </button>
              )}
```
- 在 key 列表附近(列表容器下方)渲染错误:`{deleteError && <p className="text-[10px] text-accent-red mt-1">{deleteError}</p>}`(放在 `:180` 列表 `))}` 之后、容器闭合前的合适位置)。

- [ ] **Step 2: ProviderKeyManager 内联确认 + 让 error 可见**

`apps/desktop/src/components/ProviderKeyManager.tsx`:
- 加状态:`const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);`
- 删除按钮(`:411-417`,非编辑态显示 maskedKey + Trash 的那个)改为两步确认:第一次点击 `setConfirmingDelete(p.name)`,显示 "Delete?"/"Cancel";确认调用 `handleDeleteKey(p.name)`(成功后该组件已 `fetchRegistry`;在 `handleDeleteKey` 成功分支加 `setConfirmingDelete(null)`)。保持 `e.stopPropagation()`。
- 确认 `error` 状态已在 UI 渲染(READ 组件,找 `error &&` 的展示;若删除错误未展示在非编辑态,把 `handleDeleteKey` 的错误也放到一个对用户可见的位置——例如 provider 行下方 `{error && <p className="text-[10px] text-accent-red ...">{error}</p>}`)。

- [ ] **Step 3: 验证 + 提交**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/desktop && bunx tsc --noEmit && bun run test`
Expected: 类型无新错误;vitest 全过。
```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/desktop/src/components/AccountPage.tsx apps/desktop/src/components/ProviderKeyManager.tsx
git commit -m "fix(desktop): two-step confirm + visible error for key deletion (H2-ux)"
```

---

## Task 3: H5 —— 网关失败状态可点击打开设置

**Files:** `HeroSection.tsx`

当前 `gatewayState === "failed"` 只显示截断错误文本(`:105-109`),无操作入口。`onOpenSettings` 已是 prop。改为让失败区可点击打开 Settings(Start 在 Settings → Gateway 内)。

- [ ] **Step 1: 失败区改为按钮**

`apps/desktop/src/components/HeroSection.tsx:105-109`:
```tsx
      {gatewayState === "failed" && shortError && (
        <div className="px-5 pb-2 -mt-1">
          <p className="text-[10px] text-[#FF3B30] leading-tight truncate">{shortError}</p>
        </div>
      )}
```
改为(整块可点击 → 打开设置,文案提示):
```tsx
      {gatewayState === "failed" && (
        <button
          onClick={onOpenSettings}
          className="mx-5 mb-2 px-3 py-1.5 rounded-lg flex items-center gap-2 text-left w-[calc(100%-2.5rem)] transition-colors hover:bg-[#FF3B30]/15"
          style={{ background: "rgba(255, 59, 48, 0.08)", border: "1px solid rgba(255, 59, 48, 0.15)" }}
        >
          <AlertTriangle size={12} strokeWidth={2} className="text-[#FF3B30] shrink-0" />
          <span className="text-[10px] text-[#FF3B30] font-medium leading-tight">
            Gateway failed{shortError ? ` — ${shortError}` : ""} · tap to open Settings
          </span>
        </button>
      )}
```
(`AlertTriangle` 已 import,见 `:1`。`shortError` 变量保留使用。)

- [ ] **Step 2: 验证 + 提交**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/desktop && bunx tsc --noEmit && bun run test`
```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/desktop/src/components/HeroSection.tsx
git commit -m "fix(desktop): gateway-failed banner is tappable to open Settings (H5-ux)"
```

---

## Task 4: M5 —— 余额轮询在面板隐藏时暂停

**Files:** `App.tsx`、`hooks/useCloudAuth.ts`

两处轮询:App.tsx `:205`(30s)、useCloudAuth `:199`(10s),都无条件运行。菜单栏面板失焦即隐藏,不应后台空转。改为 `document.hidden` 时跳过,`visibilitychange` 恢复时刷新一次。

- [ ] **Step 1: App.tsx 轮询跳过 hidden**

`apps/desktop/src/App.tsx:204-208`:
```ts
    // Poll balance every 30s
    const balanceInterval = setInterval(() => {
      api.cloudGetBalance().then((res) => setCloudBalanceCents(res.total_cents)).catch(() => {});
    }, 30_000);
    return () => clearInterval(balanceInterval);
```
改为:
```ts
    // Poll balance every 30s — skip while the panel is hidden (menu-bar app)
    const fetchBalance = () => {
      if (document.hidden) return;
      api.cloudGetBalance().then((res) => setCloudBalanceCents(res.total_cents)).catch(() => {});
    };
    const balanceInterval = setInterval(fetchBalance, 30_000);
    const onVisible = () => { if (!document.hidden) fetchBalance(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(balanceInterval);
      document.removeEventListener("visibilitychange", onVisible);
    };
```

- [ ] **Step 2: useCloudAuth 轮询跳过 hidden**

`apps/desktop/src/hooks/useCloudAuth.ts:196-201`(READ to confirm exact lines). The interval `setInterval(refreshBalance, 10_000)` should skip when hidden. Wrap:
```ts
  // Poll balance every 10s when authenticated — skip while hidden
  useEffect(() => {
    ...existing auth guard...
    const tick = () => { if (!document.hidden) refreshBalance(); };
    const timer = setInterval(tick, 10_000);
    const onVisible = () => { if (!document.hidden) refreshBalance(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [...existing deps...]);
```
READ the actual effect (around `:196-205`) and adapt — keep the existing auth/`cancelled` guard and dependency array; only change the interval callback to skip on hidden and add the visibilitychange listener + cleanup. There is already a window-focus refresh (`:203` "Refresh balance on window focus") — leave it; the visibilitychange addition is complementary (focus ≠ visibility, but harmless overlap; refreshBalance is idempotent).

- [ ] **Step 3: 验证 + 提交**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/desktop && bunx tsc --noEmit && bun run test`
```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/desktop/src/App.tsx apps/desktop/src/hooks/useCloudAuth.ts
git commit -m "fix(desktop): pause balance polling while panel hidden, refresh on show (M5-ux)"
```

---

## Task 5: M6 + L6 + L4 —— provider 启动期状态、Web Search 保存错误、Activity 搜索扩展

**Files:** `ProviderKeyManager.tsx`、`Settings.tsx`、`ActivityPage.tsx`

- [ ] **Step 1: M6 —— ProviderKeyManager 启动期自动重试 + 区分状态**

`apps/desktop/src/components/ProviderKeyManager.tsx`:
- `fetchRegistry`(`:31-44`)的 catch 当前完全静默且把 `loading` 关掉,导致空列表显示 "Connect to gateway to manage providers" 死路。改为:catch 时记录一个 `unreachable` 状态;并在组件挂载后、列表为空时,若网关可能还在启动,自动重试几次。最小实现:加状态 `const [fetchFailed, setFetchFailed] = useState(false);`,fetchRegistry 成功置 false、catch 置 true。再加一个有限自动重试 effect:
```ts
  useEffect(() => {
    if (!fetchFailed) return;
    const t = setTimeout(() => { fetchRegistry(); }, 2000);
    return () => clearTimeout(t);
  }, [fetchFailed, fetchRegistry]);
```
- 空状态文案(`:142-153`)区分"启动中"与"不可达":若 `fetchFailed`,文案 "Gateway not reachable yet — retrying…" + 保留手动 Refresh;否则原文案。(READ 实际空状态块并按内容修改。)

- [ ] **Step 2: L6 —— Web Search key 保存失败提示**

`apps/desktop/src/components/Settings.tsx` `handleSaveSearchKey`(`:296-307`)当前 `catch {}` 静默。加一个错误状态并展示:
- 在 Settings 组件状态区加 `const [searchError, setSearchError] = useState<string | null>(null);`
- catch 改为 `catch (err) { setSearchError(err instanceof Error ? err.message : "Failed to save search key"); }`,try 成功分支加 `setSearchError(null);`
- 在 Web Search key 输入区附近渲染 `{searchError && <p className="text-[10px] text-accent-red mt-1">{searchError}</p>}`(READ 该区块定位)。
- (与 Budget save 的错误展示风格一致——参考 `:643-645` 既有 budget 错误模式。)

- [ ] **Step 3: L4 —— Activity 搜索同时匹配 provider 与 status**

`apps/desktop/src/components/ActivityPage.tsx:34-36`:
```ts
  const filtered = search
    ? requestLog.filter((e) => e.model.toLowerCase().includes(search.toLowerCase()))
    : requestLog;
```
改为(同时匹配 model/provider/status,字段缺失安全):
```ts
  const filtered = search
    ? requestLog.filter((e) => {
        const q = search.toLowerCase();
        return (
          e.model?.toLowerCase().includes(q) ||
          e.provider?.toLowerCase().includes(q) ||
          String((e as { status?: unknown }).status ?? "").toLowerCase().includes(q)
        );
      })
    : requestLog;
```
READ the `requestLog` entry type to confirm `provider`/`status` fields exist; if a field doesn't exist on the type, drop that clause (don't invent fields). Keep `e.model` match as the baseline.

- [ ] **Step 4: 验证 + 提交**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/desktop && bunx tsc --noEmit && bun run test`
Expected: 类型无新错误;vitest 全过。
```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/desktop/src/components/ProviderKeyManager.tsx apps/desktop/src/components/Settings.tsx apps/desktop/src/components/ActivityPage.tsx
git commit -m "fix(desktop): provider startup retry, web-search save error, activity search by provider/status (M6/L6/L4-ux)"
```

---

## Task 6: Final —— 类型/测试 + 终审

- [ ] **Step 1: 全量类型检查 + UI 测试**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/desktop && find . -name '._*' -delete 2>/dev/null; bunx tsc --noEmit && bun run test`
Expected: tsc 无新错误;vitest 全过。

- [ ] **Step 2: 派终审 reviewer**

重点:(a) H1 文案与跳转——Settings 两个按钮确实 `onGoToAccount?.()` 后 `onClose()`,App 传入正确;(b) H2 两步确认逻辑无误(确认态/取消态/成功后清理),错误对用户可见;(c) H5 失败区可点击打开 Settings,`shortError` 仍正确;(d) M5 两处轮询都跳过 hidden 且 visibilitychange 监听有 cleanup,无重复/泄漏;(e) M6 自动重试有限且不无限循环,空状态文案区分清晰;(f) L6 错误展示、L4 搜索字段真实存在;(g) 无类型回退、无 scope creep。

- [ ] **Step 3: (可选)preview 验证**

若 reviewer 或用户要求,可用 preview 工具起 Vite dev 验证渲染与交互(删除确认两步、失败 banner 点击、搜索)。非必须——这些是小改动,类型 + 评审为主。

---

## Self-Review notes(作者自检)

- **范围:** 7 项(H1/H2/H5/M5/M6/L6/L4),纯前端、低风险。M7(价格)已按用户决定移出。
- **导航复用:** Settings 的 `onGoToAccount` 复用 App 既有的 `setActiveTab("account")`(HeroSection 已在用),不新增导航机制。
- **删除确认:** 用组件内联两步状态,不引入全局 Modal/确认框——最小侵入、零新依赖。错误从 `console.warn`/静默改为对用户可见。
- **轮询暂停:** 仅加 `document.hidden` 跳过 + `visibilitychange` 刷新,不做完整的双轮询合并(合并更大、收益低),都带 cleanup 防泄漏。
- **字段安全:** L4 搜索扩展要求实现者核对 `requestLog` 条目真实字段,缺失则不加该 clause,不臆造字段。
- **验证:** 以 `tsc --noEmit` + 既有 vitest 为门;无新测试基础设施;preview 为可选。
- **依赖:** 与后端各 Phase 无耦合,可独立合并。
