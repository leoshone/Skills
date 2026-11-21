---
name: violentmonkey-script-install
description: 通过 CDP 自动化在浏览器（桌面 Chromium / 安卓 Kiwi 等，含 AVD 模拟器）中安装暴力猴（Violentmonkey）用户脚本（.user.js）的完整方法。覆盖：本地 HTTP 服务提供脚本源、触发暴力猴安装确认页、自动点击"安装/重装"、失败重试与诊断、安装后验证。触发词：暴力猴、Violentmonkey、userscript、油猴脚本、.user.js、脚本安装、 Tampermonkey 迁移参考。
agent_created: true
---

# 暴力猴脚本安装（CDP 自动化）

## Overview

把 `.user.js` 用户脚本自动装进目标浏览器里的暴力猴扩展，替代手工"打开 URL → 点确认"的操作。核心机理：**浏览器导航到 `.user.js` URL 时，暴力猴会通过 webRequest 拦截并弹出安装确认页**，用 CDP 找到该确认页 target 并点击按钮即完成安装。全部经验来自 zhihu-desk2mob 项目在桌面 Turbo、MuMu 模拟器 Kiwi、真机 Quetta 三环境的实测（2026-09 ~ 11）。

## 前提

- 目标浏览器已安装暴力猴（扩展 ID 前缀 `jinjac`，完整 ID `jinjaccalgkegednnccohejagnlnfdag`）
- CDP 可达：
  - 桌面浏览器：启动参数 `--remote-debugging-port=9222`，直连 `127.0.0.1:9222`
  - 安卓设备/模拟器：`adb forward tcp:9222 localabstract:chrome_devtools_remote`（**forward 每轮 shell 都会丢**，脚本加载时自动重建）
- Node 18+（用到全局 `WebSocket`）

## Step-by-Step 流程

### Step 1 起本地 HTTP 服务提供脚本源

GitHub raw 在部分网络环境拉不到，且真机/模拟器访问宿主机需要端口映射，所以用本地服务：

```bash
cd <脚本所在目录> && python -m http.server 8899
```

- 桌面浏览器：脚本 URL 用 `http://127.0.0.1:8899/xxx.user.js`
- 安卓模拟器/真机：需 `adb reverse tcp:8899 tcp:8899`（把设备的 127.0.0.1:8899 反向映射到宿主机）；**reverse 同样每轮 shell 会丢**，脚本开头重建

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
- 已打开的旧 raw 页会干扰判断，创建新 target 前先把 URL 含 `8899` 的旧标签 `Target.closeTarget` 掉。

### Step 3 自动点击安装/重装按钮

```js
const sid = await CDP.attach(api, cts[0].targetId);
// 等按钮出现（确认页渲染慢，轮询最多 ~15s）
let ok = false;
for (let j = 0; j < 10; j++) {
  const btns = await CDP.evalJson(api,
    "(() => [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean))()", sid);
  if (btns && btns.includes('重装')) { ok = true; break; }   // 已装过 → 按钮文案是"重装"；首次安装是"安装"
  await sleep(1500);
}
await CDP.evalJs(api,
  "(() => { [...document.querySelectorAll('button')].find(b => ['安装','重装'].includes((b.innerText||'').trim())).click(); return 1; })()", sid);
await sleep(2000);
// 收尾：关掉所有 confirm 标签
for (const t of (await CDP.getTargets(api)).filter(t => (t.url || '').includes('confirm'))) {
  try { await api.send('Target.closeTarget', { targetId: t.targetId }); } catch (e) {}
}
```

### Step 4 安装后验证

打开暴力猴 options 页（`chrome-extension://jinjaccalgkegednnccohejagnlnfdag/options.html`）读取脚本列表，或在目标页检查脚本注入标记（如本项目查 `#z2m-style`）：

```js
const items = await CDP.evalJson(api, `(() => {
  const els = [...document.querySelectorAll('.script, [class*=script]')].slice(0, 10);
  return JSON.stringify(els.map(e => (e.innerText || '').split('\\n').slice(0, 3).join(' | ')));
})()`, sid);
```

## 环境陷阱速查（全部实测踩过）

| 现象 | 根因 | 处置 |
|---|---|---|
| confirm 页不再弹出 | `.user.js` URL 被 HTTP 缓存命中，webRequest 不触发 | URL 加 `?t=Date.now()` 防缓存；诊断时先看 raw 页内容是否正常（`==UserScript==` 在 innerText 中） |
| 确认页开了但找不到按钮 | 确认页渲染慢 | 轮询按钮文本最多 10~15s，不要一次性断言 |
| adb forward 失效、CDP 连不上 | forward/reverse 每轮 shell 退出都丢 | 脚本加载时（execSync 开头）自动重建，不要依赖外部一次性设置 |
| 盲目 forward 顶掉宿主机浏览器 9222 | 9222 已被桌面浏览器占用 | forward 前查 `adb forward --list`，已有 `tcp:9222` 就跳过 |
| attach 卡死不报错 | 后台标签被浏览器冻结 | attach 前先 `Target.activateTarget`（lib/cdp.js 已统一处理） |
| browser ws 连接 404 | Chrome 140+ 要求 GUID | 从 `/json/version` 取 `webSocketDebuggerUrl`，不要手拼 `ws://…/devtools/browser` |
| 长会话 evaluate 全超时 | renderer 被 CDP 长会话挂死 | 安卓端 `adb shell am force-stop <包名>` 重启浏览器 |
| CDP 消息无响应 | （桌面 Cent 实测）消息 id 为字符串 | id 用整数（lib/cdp.js 已保证） |

## 可复用脚本

- `scripts/cdp.js` — 零依赖 CDP 工具库（自动重建 forward、GUID ws、activate+attach、带超时 evaluate、截图、waitReady）。复制到项目后 `require('./cdp.js')` 即用。（browser-extension-install/scripts 下有同款副本，供其独立使用）
- `scripts/install-userjs.js` — 一体化安装器：重建 forward/reverse → 起服务提示 → 建 target → 等 confirm 页 → 点安装/重装 → 清理 confirm 标签。自带 6 轮重试。
- ~~`scripts/webstore-install.js`~~ — 已废弃（2026-11-20 实测商店点击链对注入免疫，详见文件头注释），仅留参考。

## 进阶

- 首次安装暴力猴扩展本体：用同仓库 `browser-extension-install` skill（INTERNAL crx 安装法，MV2/CDP 陷阱同样适用）。
- Android 模拟器装机准备：同仓库 `avd-install-apk` skill。
