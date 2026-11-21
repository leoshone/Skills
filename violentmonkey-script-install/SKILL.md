---
name: violentmonkey-script-install
description: 通过 CDP 自动化在浏览器（桌面 Chromium / 安卓 Kiwi 等，含 AVD 模拟器）中安装暴力猴（Violentmonkey）用户脚本（.user.js）的完整方法。覆盖：检查暴力猴是否安装/启用（含被 Chrome 权限提升禁用后的恢复）、本地 HTTP 服务提供脚本源、触发暴力猴安装确认页、自动点击"安装/重装"、失败重试与诊断、安装后验证。触发词：暴力猴、Violentmonkey、userscript、油猴脚本、.user.js、脚本安装、 Tampermonkey 迁移参考。
agent_created: true
---

# 暴力猴脚本安装（CDP 自动化）

## Overview

把 `.user.js` 用户脚本自动装进目标浏览器里的暴力猴扩展，替代手工"打开 URL → 点确认"的操作。核心机理：**浏览器导航到 `.user.js` URL 时，暴力猴会通过 webRequest 拦截并弹出安装确认页**，用 CDP 找到该确认页 target 并点击按钮即完成安装。全部经验来自 zhihu-desk2mob 项目在桌面 Turbo、MuMu 模拟器 Kiwi、AVD Kiwi、真机 Quetta 等环境的实测（2026-09 ~ 11）。

## 前提

- 目标浏览器已安装暴力猴（扩展 ID 前缀 `jinjac`，完整 ID `jinjaccalgkegednnccohejagnlnfdag`；AVD Kiwi 实测 ID 可能不同，如 `fcickoepngcnapddnnmjpkmpekmfmpaa`，**按名字匹配，别写死 ID**）
- **暴力猴处于启用状态**（见下方 Step 0——被禁用时 confirm 页根本不弹）
- CDP 可达：
  - 桌面浏览器：启动参数 `--remote-debugging-port=9222`，直连 `127.0.0.1:9222`
  - 安卓设备/模拟器：`adb forward tcp:9222 localabstract:chrome_devtools_remote`（**forward 每轮 shell 都会丢**，脚本加载时自动重建）
- Node 18+（用到全局 `WebSocket`）

## Step-by-Step 流程

### Step 0 检查暴力猴是否安装且启用（安装前必做）

`scripts/install-userjs.js` 已内置此预检（第 0 轮自动跑）。手动检查方法：

**检查**：开 `chrome://extensions/` → 该页是 Polymer 深层 shadow DOM，CDP 逐层钻取读状态：

```js
// extensions 页 shadow DOM 结构：extensions-manager → extensions-item-list → extensions-item
const r = await CDP.evalJson(api, `(() => {
  function deep(root) {
    const out = [];
    for (const e of root.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) out.push(...deep(e.shadowRoot)); }
    return out;
  }
  const mgr = document.querySelector('extensions-manager');
  if (!mgr) return 'no-mgr';
  const items = [...deep(mgr.shadowRoot)].filter(e => e.tagName === 'EXTENSIONS-ITEM');
  return JSON.stringify(items.map(it => ({
    id: it.id,
    name: it.shadowRoot.querySelector('#name')?.textContent.trim(),
    enabled: it.shadowRoot.querySelector('cr-toggle#enableToggle')?.checked,
  })));
})()`, sid);
```

**启用**（被禁用时）：⚠️ **脚本无法代点**——若扩展是因「权限提升」被 Chrome 自动禁用的，
`chrome.management.setEnabled` 会报 *"Re-enabling an extension disabled due to permissions
increase requires a user gesture"*，纯 JS `.click()` toggle 也无效。必须走真实输入：

1. **CDP `Input.dispatchMouseEvent` 点启用开关**（受信任输入，能触发手势链路）——先读开关
   `getBoundingClientRect()` 中心坐标，发 `mousePressed` + `mouseReleased`；
2. 此时会弹出「需要新权限」确认对话框 → 对话框没有 DOM 可钻，用**截图定位 + adb tap 点 OK**
   （或人工点）；
3. adb tap 坐标换算注意：**截图横纵缩放系数不同**（如截图 514×1080 对物理 1080×2400，
   x 系数 2.101、y 系数 2.222），必须分别计算，否则点偏点出别的对话框；
4. 重查 `enabled: true` 后再进安装流程。

`install-userjs.js` 预检到未安装/未启用会以退出码 2 快速失败并打印恢复步骤，
不再盲试 6 轮安装循环（2026-11-21 实测：禁用状态下 confirm 页不弹，盲试纯浪费时间）。

### Step 1 起本地 HTTP 服务提供脚本源

GitHub raw 在部分网络环境拉不到，且真机/模拟器访问宿主机需要端口映射，所以用本地服务：

```bash
cd <脚本所在目录> && python -m http.server 8899
```

- 桌面浏览器：脚本 URL 用 `http://127.0.0.1:8899/xxx.user.js`
- 安卓模拟器/真机：需 `adb reverse tcp:8899 tcp:8899`（把设备的 127.0.0.1:8899 反向映射到宿主机）；**reverse 同样每轮 shell 会丢**，脚本开头重建
- ⚠️ **服务生命周期**：`install-userjs.js` 自起的服务随脚本退出而关闭——脚本失败退出后
  raw 页会 `ERR_EMPTY_RESPONSE`，后续诊断全撞墙（2026-11-21 实测）。多轮安装/长会话
  建议**独立后台任务跑服务**，别依赖安装脚本自起的那个。

### Step 2 触发安装确认页

```js
// CDP browser 级连接后：
await api.send('Target.createTarget', { url: 'http://127.0.0.1:8899/xxx.user.js?t=' + Date.now() });
await sleep(7000);   // 暴力猴拦截 + 确认页渲染需要数秒
// 确认页 URL 含 'confirm'（暴力猴特征）
const cts = (await CDP.getTargets(api)).filter(t => t.type === 'page' && (t.url || '').includes('confirm'));
```

要点：
- **URL 加 `?t=<时间戳>` 防缓存**：缓存命中时 webRequest 拦截不触发，确认页不开——这是"confirm 页不再弹出"最常见的原因；
- 也可能确认页 URL 含扩展 ID `jinjac`（不同版本行为不一），两种特征都查；
- 已打开的旧 raw 页会干扰判断，创建新 target 前先把 URL 含 `8899` 的旧标签 `Target.closeTarget` 掉；
- confirm 页不弹的另一个解释：**暴力猴被禁用**（见 Step 0）——raw 页变下载或
  `ERR_BLOCKED_BY_CLIENT`、标签「消失」，先查扩展状态再查缓存。

### Step 3 自动点击安装/重装按钮

```js
const sid = await CDP.attach(api, cts[0].targetId);
// 等按钮出现（确认页渲染慢，轮询最多 ~15s）
// ⚠️ 文案随语言变：中文「安装/重装」，英文环境实测是 "Install…"/"Reinstall…"（带省略号）
//    —— 用 startsWith 前缀匹配，别全等
let btn = null;
for (let j = 0; j < 10; j++) {
  const btns = await CDP.evalJson(api,
    "(() => [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean))()", sid);
  // ⚠️ evalJson 返回值有时是字符串有时是数组，解析要双兼容
  const arr = (typeof btns === 'string') ? JSON.parse(btns || '[]') : (btns || []);
  btn = arr.find(b => ['安装', '重装', 'Install', 'Reinstall'].some(k => b === k || b.startsWith(k)));
  if (btn) break;
  await sleep(1500);
}
await CDP.evalJs(api,
  `(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim().startsWith('${btn.split('…')[0]}')); if (b) b.click(); return 1; })()`, sid);
await sleep(2000);
// 收尾：关掉所有 confirm 标签
for (const t of (await CDP.getTargets(api)).filter(t => (t.url || '').includes('confirm'))) {
  try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}
}
```

### Step 4 安装后验证

打开暴力猴 options 页（扩展 ID 从 Step 0 的实测值取，别写死）读取脚本列表，或在目标页检查脚本注入标记（如本项目查 `#z2m-style`）：

```js
const items = await CDP.evalJson(api, `(() => {
  const els = [...document.querySelectorAll('.script, [class*=script]')].slice(0, 10);
  return JSON.stringify(els.map(e => (e.innerText || '').split('\\n').slice(0, 3).join(' | ')));
})()`, sid);
```

⚠️ options 页可能被 Chromium 拦截（`ERR_BLOCKED_BY_CLIENT`，实测 Chrome 137 + 扩展
ID 不匹配时出现）——先确认扩展 ID 是当前环境实测值；更可靠的验证是直接看目标页注入标记。

## 环境陷阱速查（全部实测踩过）

| 现象 | 根因 | 处置 |
|---|---|---|
| confirm 页不弹、raw 页变下载或 ERR_BLOCKED_BY_CLIENT、标签「消失」 | **暴力猴被禁用**（多为扩展权限提升后 Chrome 自动关闭） | 走 Step 0：CDP 真实输入点开关 + 权限框 adb tap OK；`install-userjs.js` 已内置预检（退出码 2 + 恢复步骤） |
| `chrome.management.setEnabled` 报 requires a user gesture | 权限提升型禁用必须真实用户手势恢复 | CDP `Input.dispatchMouseEvent`（受信任输入）点 toggle；权限确认框无 DOM，截图 + adb tap 点 OK |
| adb tap 点偏、点出无关对话框 | 截图横纵缩放系数不同（如 514→1080 是 2.101、1080→2400 是 2.222） | x、y 分别按各自系数换算；点前先截图确认元素位置 |
| 确认页开了但找不到安装按钮 | ① 确认页渲染慢；② **英文环境文案是 `Install…`/`Reinstall…`** | ① 轮询 10~15s；② startsWith 前缀匹配 + 中英文案表 |
| evalJson 返回值时而是字符串时而是对象/数组 | CDP 返回值包装方式不定 | 双兼容：`typeof v === 'string' ? JSON.parse(v) : v` |
| confirm 页不再弹出 | `.user.js` URL 被 HTTP 缓存命中，webRequest 不触发 | URL 加 `?t=Date.now()` 防缓存；诊断时先看 raw 页内容是否正常（`==UserScript==` 在 innerText 中） |
| raw 页 ERR_EMPTY_RESPONSE、安装必败 | 安装脚本自起的 HTTP 服务随其失败退出被 kill | 服务独立后台跑，不依赖安装脚本自起的服务 |
| options 页打不开（ERR_BLOCKED_BY_CLIENT） | 扩展 ID 写死的是别的环境的值 | ID 按当前环境 extensions 页实测取，按名字找扩展 |
| adb forward 失效、CDP 连不上 | forward/reverse 每轮 shell 退出都丢 | 脚本加载时（execSync 开头）自动重建，不要依赖外部一次性设置 |
| 盲目 forward 顶掉宿主机浏览器 9222 | 9222 已被桌面浏览器占用 | forward 前查 `adb forward --list`，已有 `tcp:9222` 就跳过；AVD 可改走 9223 与桌面并存 |
| attach 卡死不报错 | 后台标签被浏览器冻结 | attach 前先 `Target.activateTarget`（lib/cdp.js 已统一处理）；标签堆积时先清理残留标签 |
| browser ws 连接 404 | Chrome 140+ 要求 GUID | 从 `/json/version` 取 `webSocketDebuggerUrl`，不要手拼 `ws://…/devtools/browser` |
| 长会话 evaluate 全超时 | renderer 被 CDP 长会话挂死 | 安卓端 `adb shell am force-stop <包名>` 重启浏览器 |
| CDP 消息无响应 | （桌面 Cent 实测）消息 id 为字符串 | id 用整数（lib/cdp.js 已保证） |

## 可复用脚本

- `scripts/cdp.js` — 零依赖 CDP 工具库（自动重建 forward、GUID ws、activate+attach、带超时 evaluate、截图、waitReady）。复制到项目后 `require('./cdp.js')` 即用。（browser-extension-install/scripts 下有同款副本，供其独立使用）
- `scripts/install-userjs.js` — 一体化安装器：重建 forward/reverse → **预检暴力猴安装/启用状态（禁用时快速失败 + 恢复步骤，退出码 2）** → 起 HTTP 服务 → 建 target → 等 confirm 页 → 点安装/重装（中英文案兼容）→ 清理 confirm 标签。自带 6 轮重试。
- ~~`scripts/webstore-install.js`~~ — 已废弃（2026-11-20 实测商店点击链对注入免疫，详见文件头注释），仅留参考。

## 进阶

- 首次安装暴力猴扩展本体：用同仓库 `browser-extension-install` skill（INTERNAL crx 安装法，MV2/CDP 陷阱同样适用）。
- Android 模拟器装机准备：同仓库 `avd-install-apk` skill。
