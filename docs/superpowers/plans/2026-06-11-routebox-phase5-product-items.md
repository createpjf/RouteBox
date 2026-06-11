# RouteBox Phase 5 — 大型产品项 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收尾三个较大的产品项:落地页购买 CTA 死循环修复(轻量版)、Admin 面板移动端适配 + 去重、菜单栏托盘状态指示 + 菜单增强。

**Architecture:** 三块互相独立、技术栈不同:
- **落地页 CTA**:`apps/cloud-gateway/landing.html`(实际服务)+ `apps/landing/index.html`(同字节副本)——两份都改。
- **Admin 响应式**:`apps/cloud-gateway/admin.html`(实际服务,0 个 media query)加响应式;删除无引用的死副本 `apps/cloud-gateway/admin/index.html`。
- **托盘(Rust)**:`apps/desktop/src-tauri/src/tray.rs` + `lib.rs` + `commands.rs`;动态 tooltip 状态 + 状态菜单行 + Start/Stop + Copy Endpoint,由前端 `gatewayState` 变化经 Tauri command/event 驱动。**不新增图标资源**(状态用 tooltip + 菜单文字,不做彩色图标)。

**Tech Stack:** HTML/CSS(landing/admin)、Rust + Tauri 2(tray)、TypeScript(前端 invoke/listen)。

**⚠️ 验证限制(重要):** 本卷(外置盘)`cargo build` 不可靠/曾因磁盘失败,Rust 改动**只能 read-back 验证**(沿用 Phase 0 Rust 任务的做法)。托盘任务(T3)合并后**需用户在本机 `cd apps/desktop && pnpm tauri dev` 实跑确认**托盘行为——计划会显式标注。landing/admin 为静态文件,inspect/浏览器目视验证。

---

## File Structure

| 文件 | 项 | 操作 |
|------|----|------|
| `apps/cloud-gateway/landing.html` | CTA 死循环 | Modify |
| `apps/landing/index.html` | CTA(同步副本) | Modify |
| `apps/cloud-gateway/admin.html` | 移动端响应式 | Modify |
| `apps/cloud-gateway/admin/index.html` | 死副本 | Delete |
| `apps/desktop/src-tauri/src/tray.rs` | 托盘状态/菜单 | Modify |
| `apps/desktop/src-tauri/src/commands.rs` | update_tray_status 命令 | Modify |
| `apps/desktop/src-tauri/src/lib.rs` | 注册命令 | Modify |
| `apps/desktop/src/App.tsx` | gatewayState 变化时 invoke + 监听 copy-endpoint | Modify |

**执行者必读:** 提交前 `find . -path ./node_modules -prune -o -name '._*' -delete`。忽略 `non-monotonic index` 警告。分支 `fix/audit-remediation`。Rust 改动跑 `cargo check` 若磁盘失败则 read-back 验证并在报告说明。

---

## Task 1: 落地页购买 CTA 不再死循环(轻量版)

**Files:** `apps/cloud-gateway/landing.html`、`apps/landing/index.html`(两份内容相同,改成一致)

当前 "Get Pro"/"Get Max" 链接到 `https://api.routebox.dev`,而该域名 serve 的就是这张落地页本身 → 死循环。轻量修复:指向页面内 `#download` 锚点(已存在),并加说明性 tooltip(下载 App 后在 Account 标签升级)。

- [ ] **Step 1: 改两个购买 CTA(两份文件各改一处对应的 Get Pro / Get Max)**

在 **两份文件** 中,把:
```html
<a href="https://api.routebox.dev" class="btn-ember-primary w-full justify-center text-sm py-2.5">Get Pro</a>
```
改为:
```html
<a href="#download" title="Download the app, then upgrade in the Account tab" class="btn-ember-primary w-full justify-center text-sm py-2.5">Get Pro</a>
```
把:
```html
<a href="https://api.routebox.dev" class="btn-primary w-full justify-center text-sm py-2.5">Get Max</a>
```
改为:
```html
<a href="#download" title="Download the app, then upgrade in the Account tab" class="btn-primary w-full justify-center text-sm py-2.5">Get Max</a>
```
仅改这两个购买 CTA 的 `href` 并加 `title`。**不要**动 footer 的 "API" 链接(`>API</a>`,指向 api.routebox.dev 是合理的)或 og/twitter meta 里的 api.routebox.dev。用 grep 确认两份文件各只改了 2 处。

- [ ] **Step 2: 验证**

Run:
```
cd /Volumes/ROG_500GB/RouteBox
grep -n 'href="https://api.routebox.dev"' apps/cloud-gateway/landing.html apps/landing/index.html
```
Expected: 不再有指向 api.routebox.dev 的 **购买按钮**(仅可能剩 footer 的 API 链接——确认那不是 btn-ember/btn-primary 购买按钮)。两份文件的 Get Pro/Get Max 现在 `href="#download"`。

- [ ] **Step 3: Commit**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/landing.html apps/landing/index.html
git commit -m "fix(landing): point Pro/Max CTAs to #download instead of looping to self (H3-ux)"
```

---

## Task 2: Admin 面板移动端响应式 + 删除死副本

**Files:** `apps/cloud-gateway/admin.html`(改);`apps/cloud-gateway/admin/index.html`(删)

`admin.html` 0 个 media query:固定 220px `position:fixed` 侧栏 + `margin-left:220px` 主区 + 固定 480px 模态,手机上严重溢出。`admin/index.html` 是与 `admin.html` 字节相同的副本,且 `admin-page.ts` 只读 `admin.html`,故 `admin/index.html` 是死代码。

- [ ] **Step 1: 删除死副本**

```bash
cd /Volumes/ROG_500GB/RouteBox
# 确认无引用
grep -rn "admin/index.html" apps/cloud-gateway/src || echo "no references — safe to delete"
git rm apps/cloud-gateway/admin/index.html
```
(若上面 grep 有任何引用,STOP 上报——不要删。)

- [ ] **Step 2: 加响应式 CSS**

READ `apps/cloud-gateway/admin.html` 的 `<style>`,定位侧栏(`width:220px`/`position:fixed`)、主区(`margin-left:220px`)、模态(`width:480px`)的规则。在 `<style>` 末尾(`</style>` 之前)追加移动端断点:
```css
    @media (max-width: 768px) {
      /* 侧栏改为顶部横向条,主区不再左缩进 */
      .sidebar { position: static; width: 100%; height: auto; display: flex; flex-wrap: wrap; gap: 4px; }
      .main, [class*="main"] { margin-left: 0 !important; padding: 12px !important; }
      /* 模态自适应宽度 */
      .modal, [class*="modal"] { width: calc(100vw - 24px) !important; max-width: 480px; }
      /* 表格横向滚动,避免撑破视口 */
      table { display: block; overflow-x: auto; white-space: nowrap; }
    }
```
**实现者:** 上面的选择器是按审计描述的占位——你必须 READ admin.html 的真实 class 名/结构,把选择器替换为实际匹配侧栏/主区/模态/表格的选择器。目标:≤768px 时侧栏不再固定 220px 占位、主区无 220px 左缩进、模态不超出视口、宽表格可横向滚动。保持桌面端(>768px)外观完全不变(媒体查询只在窄屏生效)。

- [ ] **Step 3: 验证**

Run: `grep -c "@media" /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway/admin.html`(应 ≥1)。
若环境允许起服务并用 preview 工具(`preview_resize` 到 ~390px)目视确认侧栏/主区/模态在窄屏不溢出;否则 read-back 确认选择器与真实结构匹配,并在报告说明未做浏览器目视。

- [ ] **Step 4: Commit**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/admin.html apps/cloud-gateway/admin/index.html
git commit -m "fix(admin): mobile-responsive layout + remove dead duplicate admin/index.html (M2-ux)"
```

---

## Task 3: 托盘状态指示 + 菜单增强(Rust;read-back 验证)

**Files:** `apps/desktop/src-tauri/src/tray.rs`、`commands.rs`、`lib.rs`、`apps/desktop/src/App.tsx`

当前托盘:静态 template 图标、静态 tooltip "RouteBox"、菜单仅 Open/Quit;无状态指示。目标(**不新增图标资源**):
- 动态 tooltip 反映状态(Running / Stopped / Failed)。
- 菜单加一个禁用的状态行(显示当前状态)+ Start Gateway / Stop Gateway / Copy Endpoint。
- 由前端 `gatewayState` 变化经 `update_tray_status` 命令驱动。
- 顺手修 `tray.rs:15` 的 `default_window_icon().unwrap()` 潜在 panic(改为 `if let Some(icon)`)。

**前置 READ(实现者必做):** `commands.rs` 里 `start_gateway`/`stop_gateway` 的确切签名(参数、是否 async);`lib.rs` 里 `invoke_handler![...]` 注册列表与 tray 创建位置;App.tsx 里 `gatewayState` 状态与 `@tauri-apps/api` 的 invoke/event 用法(项目是否已用 `listen`)。按真实签名适配,以下为结构指引。

- [ ] **Step 1: tray.rs —— 用 id 建托盘、加菜单项、暴露更新函数**

把 `create_tray` 改为:给 `TrayIconBuilder` 设 id(如 `.with_id("main")` 或 `TrayIconBuilder::with_id("main")`,按 Tauri 2 API),菜单加项:一个禁用状态行 `status`(`MenuItem::with_id(app, "status", "Gateway: …", false, None)`)、`start`、`stop`、`copy_endpoint`、保留 `open`/`quit`。`default_window_icon().unwrap()` 改为安全处理:
```rust
    let builder = TrayIconBuilder::with_id("main")
        .icon_as_template(true)
        .tooltip("RouteBox")
        .menu(&menu)
        .show_menu_on_left_click(false);
    let builder = match app.default_window_icon() {
        Some(icon) => builder.icon(icon.clone()),
        None => builder,
    };
```
`on_menu_event` 增加分支:
```rust
            "start" => { let h = app.clone(); tauri::async_runtime::spawn(async move { let _ = crate::commands::start_gateway(h, None).await; }); }
            "stop"  => { let h = app.clone(); tauri::async_runtime::spawn(async move { let _ = crate::commands::stop_gateway(h).await; }); }
            "copy_endpoint" => { let _ = app.emit("tray://copy-endpoint", ()); }
```
**实现者:** `start_gateway`/`stop_gateway` 的真实签名以 commands.rs 为准(参数个数/类型可能不同,例如 port 参数)——按实际签名调用。`app.emit` 需要 `use tauri::Emitter;`(Tauri 2)。保留既有 open/quit 与 `on_tray_icon_event` 左键逻辑不变。

- [ ] **Step 2: tray.rs —— 暴露 `update_tray(app, status)` 更新 tooltip + 状态行**

新增模块函数:
```rust
pub fn update_tray<R: Runtime>(app: &tauri::AppHandle<R>, status: &str) {
    // status: "running" | "stopped" | "failed" | "starting" | ...
    let (label, tip) = match status {
        "running" => ("Gateway: Running", "RouteBox — Running"),
        "starting" => ("Gateway: Starting…", "RouteBox — Starting…"),
        "failed" => ("Gateway: Failed", "RouteBox — Gateway failed"),
        _ => ("Gateway: Stopped", "RouteBox — Stopped"),
    };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tip));
    }
    // 状态菜单行文字更新:需保存 MenuItem 句柄或经 app state 取回;
    // 若 Tauri 2 无法按 id 取回 MenuItem,则仅更新 tooltip(状态行可省略或重建菜单)。
    let _ = label; // 实现者:能更新则更新状态行文字,否则去掉 status 菜单项,仅留 tooltip
}
```
**实现者:** Tauri 2 更新 MenuItem 文字需持有 `MenuItem` 句柄(`set_text`)。若实现成本高,**退化为只更新 tooltip**(去掉 status 菜单行),保证 tooltip 状态可用——这是最小高价值子集。报告你采用的方案。

- [ ] **Step 3: commands.rs —— `update_tray_status` 命令**

```rust
#[tauri::command]
pub fn update_tray_status(app: tauri::AppHandle, status: String) {
    crate::tray::update_tray(&app, &status);
}
```
(放在其它 `#[tauri::command]` 旁;`crate::tray` 路径按实际模块结构。)

- [ ] **Step 4: lib.rs —— 注册命令**

在 `invoke_handler(tauri::generate_handler![...])` 列表里加入 `commands::update_tray_status`(READ 现有列表,按相同风格追加;确认 `commands` 模块路径)。

- [ ] **Step 5: App.tsx —— 状态变化时 invoke + 监听 copy-endpoint**

READ App.tsx 现有 `gatewayState` 与 Tauri import 方式(项目已用 `@tauri-apps/api/core` invoke / `@tauri-apps/api/event` listen 的话沿用;注意桌面/浏览器双模式——用 lazy import 包裹避免浏览器报错,参考既有 Tauri 调用模式)。
- 加一个 effect:`gatewayState` 变化时 `invoke("update_tray_status", { status: gatewayState })`(失败静默,浏览器模式跳过)。
- 加一个 effect:`listen("tray://copy-endpoint", () => { /* 复制 endpoint+token 到剪贴板 */ })`——复制逻辑复用 Account 页已有的 endpoint/token 与 `navigator.clipboard.writeText`;并 `showToast("Endpoint copied")`。READ 现有获取 endpoint/token 的方式(constants/api),按真实来源拼接。effect 卸载时 `unlisten`。
**实现者:** 严格遵循项目既有的 Tauri 调用/双模式封装,不要引入新的全局 import 破坏浏览器构建。

- [ ] **Step 6: 验证(read-back + 尽力 cargo check)**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/desktop/src-tauri && cargo check 2>&1 | tail -15`
- 若编译通过:报告通过。
- 若因磁盘/环境失败:read-back 验证——确认 (a) tray.rs 用 id 建托盘且 `unwrap()` 已去除;(b) `update_tray` / `update_tray_status` / 命令注册三处签名与路径一致;(c) `start_gateway`/`stop_gateway` 调用与 commands.rs 真实签名匹配;(d) App.tsx invoke/listen 用了项目既有封装、不破坏浏览器构建(跑 `cd apps/desktop && bunx tsc --noEmit` 验证前端类型)。报告所用验证方式。
前端类型必须过:`cd /Volumes/ROG_500GB/RouteBox/apps/desktop && bunx tsc --noEmit`(expect clean)。

- [ ] **Step 7: Commit**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/desktop/src-tauri/src/tray.rs apps/desktop/src-tauri/src/commands.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/App.tsx
git commit -m "feat(desktop): tray status tooltip + Start/Stop/Copy-Endpoint menu, driven by gateway state (tray-ux)"
```

---

## Task 4: Final —— 验证 + 终审

- [ ] **Step 1: 前端类型 + 测试**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/desktop && find . -name '._*' -delete 2>/dev/null; bunx tsc --noEmit && bun run test`
Expected: tsc 干净;vitest 全过(30/30)。

- [ ] **Step 2: Rust(尽力)**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/desktop/src-tauri && cargo check 2>&1 | tail -10`
若磁盘失败,记录为环境限制,依赖 Task 3 的 read-back。

- [ ] **Step 3: 静态文件目视/grep**

确认 landing 两份无购买 CTA 指向 api.routebox.dev;admin.html 有 media query 且 admin/index.html 已删。

- [ ] **Step 4: 派终审 reviewer**

重点:(a) landing 两份一致且仅改购买 CTA;(b) admin 媒体查询选择器匹配真实结构、桌面端不受影响、死副本已删;(c) tray 用 id 建/取、`unwrap` 已去、命令注册与签名一致、前端 invoke/listen 不破坏浏览器构建;(d) **明确标注 Rust 未经 cargo 验证(若是),提示用户实跑 `pnpm tauri dev` 确认托盘**。

---

## Self-Review notes(作者自检)

- **三项独立、技术栈不同**,可分别合并。landing/admin 静态、低风险、可目视;tray 是 Rust + 前端联动、风险最高且**本环境无法 cargo 验证**——计划已显式要求 read-back + 前端 tsc + 用户实跑确认。
- **托盘不新增图标资源**:状态用 tooltip(+ 可选菜单状态行),彩色状态图标留作后续(需美术资源)。Copy Endpoint 经 Tauri event 让前端用 `navigator.clipboard` 完成,避免新增 clipboard 插件/权限。
- **退化路径**:若 Tauri 2 更新 MenuItem 文字成本高,T3 退化为「仅动态 tooltip」——仍是高价值最小子集;实现者需报告所采方案。
- **去重**:admin/index.html 确认无引用后删除(单一来源 admin.html);landing 两份保持同步(本期不强行合并来源,只同改 CTA)。
- **签名风险**:T3 多处依赖 commands.rs/lib.rs 真实签名,计划要求实现者先 READ 再适配,不臆造。
- **依赖**:与后端各 Phase 无耦合;App.tsx 的 tray invoke 与 Phase 4 的 gatewayState 不冲突。
